from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from .. import db as d
from ..db import Database
from ..keyboards import skip_comment_kb
from ..states import RateComment

router = Router()

MAX_COMMENT = 300


@router.callback_query(F.data == "rate:skip_comment")
async def cb_skip_comment(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("✅ Спасибо! Оценка сохранена.")
    await callback.answer()


@router.callback_query(F.data.startswith("rate:"))
async def cb_rate(callback: CallbackQuery, db: Database, state: FSMContext):
    _, deal_id, score_str = callback.data.split(":")
    score = int(score_str)
    deal = await db.get_deal(deal_id)

    if deal is None or deal["status"] not in (d.COMPLETED, d.REFUNDED):
        await callback.answer("Оценивать можно только завершённые сделки.", show_alert=True)
        return
    user_id = callback.from_user.id
    if user_id not in (deal["seller_id"], deal["buyer_id"]):
        await callback.answer("Вы не участник этой сделки.", show_alert=True)
        return

    to_user = deal["seller_id"] if user_id == deal["buyer_id"] else deal["buyer_id"]
    created = await db.add_rating(deal_id, user_id, to_user, score)
    if not created:
        await callback.answer("Вы уже оценили эту сделку.", show_alert=True)
        return

    emoji = "👍" if score > 0 else "👎"
    await state.set_state(RateComment.waiting_comment)
    await state.update_data(rate_deal_id=deal_id)
    await callback.message.edit_text(
        f"{emoji} Оценка сохранена!\n\n"
        f"💬 Хотите оставить текстовый отзыв? Отправьте его сообщением "
        f"(до {MAX_COMMENT} символов) или пропустите.",
        reply_markup=skip_comment_kb(),
    )
    await callback.answer()


@router.message(RateComment.waiting_comment)
async def msg_comment(message: Message, state: FSMContext, db: Database):
    comment = (message.text or "").strip()
    if not comment:
        await message.answer("❌ Отправьте текст отзыва или нажмите «Пропустить».")
        return
    if len(comment) > MAX_COMMENT:
        await message.answer(f"❌ Слишком длинно (максимум {MAX_COMMENT} символов). Сократите:")
        return
    data = await state.get_data()
    await db.set_rating_comment(data["rate_deal_id"], message.from_user.id, comment)
    await state.clear()
    await message.answer("✅ Спасибо! Отзыв сохранён и будет виден в профиле контрагента.")
