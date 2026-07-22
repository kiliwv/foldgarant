from html import escape

import aiosqlite

from . import db as d

STATUS_LABELS = {
    d.WAITING_PARTY: "⏳ Ожидает второго участника",
    d.WAITING_PAYMENT: "💳 Ожидает оплату",
    d.PAID: "🔒 Деньги в холде у гаранта",
    d.COMPLETED: "✅ Завершена",
    d.REFUNDED: "↩️ Возврат покупателю",
    d.DISPUTED: "⚠️ Открыт спор",
    d.CANCELLED: "❌ Отменена",
}


def fmt_amount(amount: float) -> str:
    return f"{amount:.8f}".rstrip("0").rstrip(".")


def mention(user_id: int | None, username: str | None = None) -> str:
    if user_id is None:
        return "—"
    if username:
        return f"@{escape(username)}"
    return f'<a href="tg://user?id={user_id}">пользователь {user_id}</a>'


async def user_mention(database, user_id: int | None) -> str:
    if user_id is None:
        return "—"
    user = await database.get_user(user_id)
    return mention(user_id, user["username"] if user else None)


async def deal_card(database, deal: aiosqlite.Row) -> str:
    seller = await user_mention(database, deal["seller_id"])
    buyer = await user_mention(database, deal["buyer_id"])
    return (
        f"🧾 <b>Сделка #{deal['id']}</b>\n"
        f"├ Продавец: {seller}\n"
        f"├ Покупатель: {buyer}\n"
        f"├ Сумма: <b>{fmt_amount(deal['amount'])} {deal['asset']}</b>\n"
        f"├ Описание: {escape(deal['description'])}\n"
        f"└ Статус: {STATUS_LABELS.get(deal['status'], deal['status'])}"
    )


def reputation_line(positive: int, negative: int) -> str:
    total = positive + negative
    if total == 0:
        return "нет оценок"
    percent = round(positive / total * 100)
    return f"👍 {positive} / 👎 {negative} ({percent}% положительных)"
