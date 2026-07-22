from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart, Command
from aiogram.types import CallbackQuery, Message

from ..db import Database
from ..keyboards import join_deal_kb, main_menu
from ..utils import deal_card

router = Router()

WELCOME = (
    "👋 <b>Добро пожаловать в гарант-бота!</b>\n\n"
    "Я выступаю посредником в сделках между покупателем и продавцом:\n"
    "деньги покупателя хранятся у меня (через @CryptoBot) и передаются "
    "продавцу только после подтверждения получения товара или услуги.\n\n"
    "Выберите действие:"
)

HELP_TEXT = (
    "ℹ️ <b>Как проходит сделка</b>\n\n"
    "1️⃣ Один из участников создаёт сделку и получает ссылку-приглашение.\n"
    "2️⃣ Второй участник переходит по ссылке и присоединяется.\n"
    "3️⃣ Покупатель оплачивает счёт через @CryptoBot — деньги замораживаются у гаранта.\n"
    "4️⃣ Продавец передаёт товар/услугу.\n"
    "5️⃣ Покупатель подтверждает получение — деньги уходят продавцу (за вычетом комиссии сервиса).\n\n"
    "⚠️ Если что-то пошло не так — любая из сторон может открыть спор, "
    "его рассмотрит администратор.\n"
    "⭐️ После каждой сделки участники оценивают друг друга — так формируется репутация.\n\n"
    "⚡️ <b>Сделка прямо в чате</b>: в любом диалоге введите\n"
    "<code>@имя_бота 25 USDT дизайн логотипа</code>\n"
    "выберите роль — и собеседнику придёт приглашение с кнопкой (как @send у CryptoBot).\n\n"
    "❗️ Для получения выплат у вас должен быть открыт @CryptoBot (нажмите там Start)."
)


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject, db: Database):
    user = message.from_user
    await db.upsert_user(user.id, user.username, user.full_name)

    args = command.args or ""
    if args.startswith("deal_"):
        deal_id = args.removeprefix("deal_")
        deal = await db.get_deal(deal_id)
        if deal is None:
            await message.answer("❌ Сделка не найдена.", reply_markup=main_menu())
            return
        if deal["status"] != "waiting_party":
            await message.answer(
                "❌ К этой сделке уже нельзя присоединиться.", reply_markup=main_menu()
            )
            return
        if user.id == deal["creator_id"]:
            await message.answer(
                "🙃 Это ваша собственная сделка — отправьте ссылку второму участнику."
            )
            return
        card = await deal_card(db, deal)
        role = "продавца" if deal["seller_id"] is None else "покупателя"
        await message.answer(
            f"{card}\n\nВам предлагают присоединиться в роли <b>{role}</b>.",
            reply_markup=join_deal_kb(deal_id),
        )
        return

    await message.answer(WELCOME, reply_markup=main_menu())


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(HELP_TEXT, reply_markup=main_menu())


@router.callback_query(F.data == "menu:help")
async def cb_help(callback: CallbackQuery):
    await callback.message.answer(HELP_TEXT, reply_markup=main_menu())
    await callback.answer()
