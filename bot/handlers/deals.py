from html import escape

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from .. import db as d
from ..config import Config
from ..cryptopay import CryptoPay, CryptoPayError
from ..db import Database
from ..keyboards import (
    asset_kb,
    buyer_escrow_kb,
    cancel_deal_kb,
    confirm_deal_kb,
    confirm_release_kb,
    dispute_resolve_kb,
    main_menu,
    pay_kb,
    role_kb,
    seller_escrow_kb,
)
from ..services import notify, refund_to_buyer, release_to_seller
from ..states import NewDeal
from ..utils import deal_card, fmt_amount

router = Router()

MAX_DESCRIPTION = 500


# --- Создание сделки --------------------------------------------------------

@router.message(Command("newdeal"))
async def cmd_newdeal(message: Message, state: FSMContext, db: Database):
    user = message.from_user
    await db.upsert_user(user.id, user.username, user.full_name)
    await state.clear()
    await state.set_state(NewDeal.role)
    await message.answer("🤝 <b>Новая сделка</b>\n\nКто вы в этой сделке?", reply_markup=role_kb())


@router.callback_query(F.data == "menu:newdeal")
async def cb_newdeal(callback: CallbackQuery, state: FSMContext, db: Database):
    user = callback.from_user
    await db.upsert_user(user.id, user.username, user.full_name)
    await state.clear()
    await state.set_state(NewDeal.role)
    await callback.message.answer(
        "🤝 <b>Новая сделка</b>\n\nКто вы в этой сделке?", reply_markup=role_kb()
    )
    await callback.answer()


@router.callback_query(F.data == "newdeal:cancel")
async def cb_newdeal_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("❌ Создание сделки отменено.")
    await callback.message.answer("Главное меню:", reply_markup=main_menu())
    await callback.answer()


@router.callback_query(NewDeal.role, F.data.startswith("role:"))
async def cb_role(callback: CallbackQuery, state: FSMContext, config: Config):
    role = callback.data.split(":")[1]
    await state.update_data(role=role)
    await state.set_state(NewDeal.asset)
    await callback.message.edit_text(
        "💱 Выберите валюту сделки:", reply_markup=asset_kb(config.assets)
    )
    await callback.answer()


@router.callback_query(NewDeal.asset, F.data.startswith("asset:"))
async def cb_asset(callback: CallbackQuery, state: FSMContext, config: Config):
    asset = callback.data.split(":")[1]
    if asset not in config.assets:
        await callback.answer("Недоступная валюта", show_alert=True)
        return
    await state.update_data(asset=asset)
    await state.set_state(NewDeal.amount)
    await callback.message.edit_text(
        f"💰 Введите сумму сделки в <b>{asset}</b> "
        f"(минимум {fmt_amount(config.min_amount)}):"
    )
    await callback.answer()


@router.message(NewDeal.amount)
async def msg_amount(message: Message, state: FSMContext, config: Config):
    try:
        amount = float((message.text or "").replace(",", ".").strip())
    except ValueError:
        await message.answer("❌ Введите число, например: <code>10.5</code>")
        return
    if amount < config.min_amount:
        await message.answer(
            f"❌ Минимальная сумма — {fmt_amount(config.min_amount)}. Введите сумму ещё раз:"
        )
        return
    await state.update_data(amount=round(amount, 8))
    await state.set_state(NewDeal.description)
    await message.answer(
        "📝 Опишите предмет сделки (что передаётся, сроки, условия). "
        f"До {MAX_DESCRIPTION} символов:"
    )


@router.message(NewDeal.description)
async def msg_description(message: Message, state: FSMContext, config: Config):
    description = (message.text or "").strip()
    if not description:
        await message.answer("❌ Отправьте текстовое описание сделки:")
        return
    if len(description) > MAX_DESCRIPTION:
        await message.answer(f"❌ Слишком длинно (максимум {MAX_DESCRIPTION} символов). Сократите:")
        return
    await state.update_data(description=description)
    data = await state.get_data()
    await state.set_state(NewDeal.confirm)

    role_label = "продавец" if data["role"] == "seller" else "покупатель"
    payout = data["amount"] * (1 - config.commission_percent / 100)
    await message.answer(
        "🔎 <b>Проверьте условия сделки:</b>\n\n"
        f"├ Ваша роль: <b>{role_label}</b>\n"
        f"├ Сумма: <b>{fmt_amount(data['amount'])} {data['asset']}</b>\n"
        f"├ Комиссия сервиса: {config.commission_percent}% "
        f"(продавец получит {fmt_amount(round(payout, 8))} {data['asset']})\n"
        f"└ Описание: {escape(description)}",
        reply_markup=confirm_deal_kb(),
    )


@router.callback_query(NewDeal.confirm, F.data == "newdeal:confirm")
async def cb_confirm(callback: CallbackQuery, state: FSMContext, db: Database, bot: Bot):
    data = await state.get_data()
    await state.clear()
    deal_id = await db.create_deal(
        creator_id=callback.from_user.id,
        creator_role=data["role"],
        asset=data["asset"],
        amount=data["amount"],
        description=data["description"],
    )
    me = await bot.get_me()
    link = f"https://t.me/{me.username}?start=deal_{deal_id}"
    await callback.message.edit_text(
        f"✅ <b>Сделка #{deal_id} создана!</b>\n\n"
        "Отправьте эту ссылку второму участнику:\n"
        f"{link}\n\n"
        "Как только он присоединится, я пришлю счёт покупателю.",
        reply_markup=cancel_deal_kb(deal_id),
    )
    await callback.answer()


# --- Присоединение и оплата --------------------------------------------------

@router.callback_query(F.data.startswith("deal:join:"))
async def cb_join(
    callback: CallbackQuery, db: Database, bot: Bot, cp: CryptoPay, config: Config
):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    user = callback.from_user

    if deal is None or deal["status"] != d.WAITING_PARTY:
        await callback.answer("К этой сделке уже нельзя присоединиться.", show_alert=True)
        return
    if user.id == deal["creator_id"]:
        await callback.answer("Нельзя присоединиться к собственной сделке.", show_alert=True)
        return

    await db.upsert_user(user.id, user.username, user.full_name)
    await db.join_deal(deal_id, user.id)
    deal = await db.get_deal(deal_id)

    # Выставляем счёт покупателю
    try:
        invoice = await cp.create_invoice(
            asset=deal["asset"],
            amount=deal["amount"],
            description=f"Сделка #{deal_id}: {deal['description'][:100]}",
            payload=deal_id,
        )
    except CryptoPayError as e:
        await callback.answer(f"Ошибка создания счёта: {e.name}", show_alert=True)
        return

    await db.set_invoice(deal_id, invoice["invoice_id"], invoice["bot_invoice_url"])
    card = await deal_card(db, await db.get_deal(deal_id))

    await callback.message.edit_text(f"🤝 Вы присоединились к сделке!\n\n{card}")
    await notify(
        bot, deal["creator_id"],
        f"🤝 Второй участник присоединился к сделке!\n\n{card}",
    )

    pay_text = (
        f"💳 <b>Счёт на оплату сделки #{deal_id}</b>\n\n"
        f"Сумма: <b>{fmt_amount(deal['amount'])} {deal['asset']}</b>\n"
        "Оплатите через @CryptoBot — средства будут храниться у гаранта "
        "до подтверждения получения товара/услуги."
    )
    await notify(
        bot, deal["buyer_id"], pay_text,
        reply_markup=pay_kb(invoice["bot_invoice_url"], deal_id),
    )
    await callback.answer()


# --- Отмена до оплаты ---------------------------------------------------------

@router.callback_query(F.data.startswith("deal:cancel:"))
async def cb_cancel(callback: CallbackQuery, db: Database, bot: Bot):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None:
        await callback.answer("Сделка не найдена.", show_alert=True)
        return
    if callback.from_user.id not in (deal["seller_id"], deal["buyer_id"], deal["creator_id"]):
        await callback.answer("Вы не участник этой сделки.", show_alert=True)
        return
    if deal["status"] not in (d.WAITING_PARTY, d.WAITING_PAYMENT):
        await callback.answer(
            "Сделку нельзя отменить после оплаты. Откройте спор.", show_alert=True
        )
        return

    await db.set_status(deal_id, d.CANCELLED)
    await callback.message.edit_text(f"❌ Сделка #{deal_id} отменена.")
    for uid in {deal["seller_id"], deal["buyer_id"], deal["creator_id"]} - {None, callback.from_user.id}:
        await notify(bot, uid, f"❌ Сделка #{deal_id} отменена вторым участником.")
    await callback.answer()


# --- Действия в холде -----------------------------------------------------------

@router.callback_query(F.data.startswith("deal:release:"))
async def cb_release(callback: CallbackQuery, db: Database):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != d.PAID:
        await callback.answer("Действие недоступно для этой сделки.", show_alert=True)
        return
    if callback.from_user.id != deal["buyer_id"]:
        await callback.answer("Подтвердить получение может только покупатель.", show_alert=True)
        return
    await callback.message.edit_text(
        f"❗️ Вы подтверждаете, что получили товар/услугу по сделке #{deal_id}?\n"
        "После подтверждения деньги будут <b>сразу выплачены продавцу</b> — "
        "отменить это действие невозможно.",
        reply_markup=confirm_release_kb(deal_id),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("deal:back:"))
async def cb_back(callback: CallbackQuery, db: Database):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != d.PAID:
        await callback.answer()
        return
    card = await deal_card(db, deal)
    await callback.message.edit_text(card, reply_markup=buyer_escrow_kb(deal_id))
    await callback.answer()


@router.callback_query(F.data.startswith("deal:release2:"))
async def cb_release_confirmed(
    callback: CallbackQuery, db: Database, bot: Bot, cp: CryptoPay, config: Config
):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != d.PAID:
        await callback.answer("Действие недоступно для этой сделки.", show_alert=True)
        return
    if callback.from_user.id != deal["buyer_id"]:
        await callback.answer("Подтвердить получение может только покупатель.", show_alert=True)
        return

    await callback.message.edit_text(f"⏳ Выплачиваю средства продавцу по сделке #{deal_id}...")
    ok = await release_to_seller(bot, db, cp, config, deal, initiator="buyer")
    if not ok:
        await callback.message.edit_text(
            f"🚨 Не удалось выполнить выплату по сделке #{deal_id}. "
            "Администраторы уведомлены и разберутся вручную."
        )
    await callback.answer()


@router.callback_query(F.data.startswith("deal:refund:"))
async def cb_refund(
    callback: CallbackQuery, db: Database, bot: Bot, cp: CryptoPay, config: Config
):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != d.PAID:
        await callback.answer("Действие недоступно для этой сделки.", show_alert=True)
        return
    if callback.from_user.id != deal["seller_id"]:
        await callback.answer("Вернуть деньги может только продавец.", show_alert=True)
        return

    await callback.message.edit_text(f"⏳ Возвращаю средства покупателю по сделке #{deal_id}...")
    ok = await refund_to_buyer(bot, db, cp, config, deal, initiator="seller")
    if not ok:
        await callback.message.edit_text(
            f"🚨 Не удалось выполнить возврат по сделке #{deal_id}. "
            "Администраторы уведомлены и разберутся вручную."
        )
    await callback.answer()


# --- Спор ---------------------------------------------------------------------

@router.callback_query(F.data.startswith("deal:dispute:"))
async def cb_dispute(callback: CallbackQuery, db: Database, bot: Bot, config: Config):
    deal_id = callback.data.split(":")[2]
    deal = await db.get_deal(deal_id)
    if deal is None or deal["status"] != d.PAID:
        await callback.answer("Спор можно открыть только по оплаченной сделке.", show_alert=True)
        return
    if callback.from_user.id not in (deal["seller_id"], deal["buyer_id"]):
        await callback.answer("Вы не участник этой сделки.", show_alert=True)
        return

    await db.set_status(deal_id, d.DISPUTED)
    card = await deal_card(db, await db.get_deal(deal_id))

    await callback.message.edit_text(
        f"⚠️ По сделке #{deal_id} открыт спор. Администратор рассмотрит его и примет решение.\n\n"
        "Опишите ситуацию и пришлите доказательства администратору, когда он свяжется с вами."
    )
    other = deal["seller_id"] if callback.from_user.id == deal["buyer_id"] else deal["buyer_id"]
    await notify(
        bot, other,
        f"⚠️ По сделке #{deal_id} второй участник открыл спор. "
        "Администратор рассмотрит его и примет решение.",
    )
    if not config.admin_ids:
        await callback.answer("Внимание: в конфиге не заданы администраторы!", show_alert=True)
        return
    for admin_id in config.admin_ids:
        await notify(
            bot, admin_id,
            f"⚠️ <b>Новый спор!</b> Открыл: {callback.from_user.id} "
            f"(@{callback.from_user.username or '—'})\n\n{card}",
            reply_markup=dispute_resolve_kb(deal_id),
        )
    await callback.answer()


# --- Мои сделки ------------------------------------------------------------------

async def send_my_deals(message: Message, db: Database, user_id: int):
    deals = await db.user_active_deals(user_id)
    if not deals:
        await message.answer("📂 У вас нет активных сделок.", reply_markup=main_menu())
        return
    for deal in deals:
        card = await deal_card(db, deal)
        kb = None
        if deal["status"] == d.PAID:
            kb = buyer_escrow_kb(deal["id"]) if user_id == deal["buyer_id"] else seller_escrow_kb(deal["id"])
        elif deal["status"] == d.WAITING_PAYMENT and user_id == deal["buyer_id"] and deal["pay_url"]:
            kb = pay_kb(deal["pay_url"], deal["id"])
        elif deal["status"] in (d.WAITING_PARTY, d.WAITING_PAYMENT):
            kb = cancel_deal_kb(deal["id"])
        await message.answer(card, reply_markup=kb)


@router.message(Command("mydeals"))
async def cmd_mydeals(message: Message, db: Database):
    await send_my_deals(message, db, message.from_user.id)


@router.callback_query(F.data == "menu:mydeals")
async def cb_mydeals(callback: CallbackQuery, db: Database):
    await send_my_deals(callback.message, db, callback.from_user.id)
    await callback.answer()
