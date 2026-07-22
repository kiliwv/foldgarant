from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from ..config import Config
from ..cryptopay import CryptoPay
from ..db import Database
from ..keyboards import dispute_resolve_kb
from ..services import refund_to_buyer, release_to_seller
from ..utils import deal_card, fmt_amount

router = Router()


def is_admin(user_id: int, config: Config) -> bool:
    return user_id in config.admin_ids


@router.message(Command("disputes"))
async def cmd_disputes(message: Message, db: Database, config: Config):
    if not is_admin(message.from_user.id, config):
        return
    deals = await db.disputed_deals()
    if not deals:
        await message.answer("✅ Открытых споров нет.")
        return
    for deal in deals:
        card = await deal_card(db, deal)
        await message.answer(card, reply_markup=dispute_resolve_kb(deal["id"]))


@router.callback_query(F.data.startswith("resolve:"))
async def cb_resolve(
    callback: CallbackQuery, db: Database, bot: Bot, cp: CryptoPay, config: Config
):
    if not is_admin(callback.from_user.id, config):
        await callback.answer("Только для администраторов.", show_alert=True)
        return
    _, action, deal_id = callback.data.split(":")
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != "disputed":
        await callback.answer("Спор по этой сделке уже закрыт.", show_alert=True)
        return

    await callback.message.edit_text(f"⏳ Закрываю спор по сделке #{deal_id}...")
    if action == "release":
        ok = await release_to_seller(bot, db, cp, config, deal, initiator="admin")
        result = "выплачены продавцу" if ok else "ОШИБКА выплаты"
    else:
        ok = await refund_to_buyer(bot, db, cp, config, deal, initiator="admin")
        result = "возвращены покупателю" if ok else "ОШИБКА возврата"
    await callback.message.edit_text(f"⚖️ Спор по сделке #{deal_id}: средства {result}.")
    await callback.answer()


@router.message(Command("balance"))
async def cmd_balance(message: Message, cp: CryptoPay, config: Config):
    if not is_admin(message.from_user.id, config):
        return
    balances = await cp.get_balance()
    lines = ["💰 <b>Баланс приложения Crypto Pay:</b>"]
    for b in balances:
        available = float(b.get("available", 0))
        if available > 0 or b["currency_code"] in config.assets:
            lines.append(f"├ {b['currency_code']}: {fmt_amount(available)}")
    await message.answer("\n".join(lines))


@router.message(Command("ban"))
async def cmd_ban(message: Message, db: Database, config: Config):
    if not is_admin(message.from_user.id, config):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: <code>/ban ID_пользователя</code>")
        return
    await db.set_banned(int(parts[1]), True)
    await message.answer(f"🚫 Пользователь {parts[1]} заблокирован.")


@router.message(Command("unban"))
async def cmd_unban(message: Message, db: Database, config: Config):
    if not is_admin(message.from_user.id, config):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: <code>/unban ID_пользователя</code>")
        return
    await db.set_banned(int(parts[1]), False)
    await message.answer(f"✅ Пользователь {parts[1]} разблокирован.")
