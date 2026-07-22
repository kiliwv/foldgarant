from datetime import datetime
from html import escape

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from ..db import Database
from ..utils import fmt_amount, reputation_line

router = Router()


async def profile_text(db: Database, user_id: int) -> str:
    user = await db.get_user(user_id)
    if user is None:
        return "❌ Пользователь не найден. Нажмите /start."

    stats = await db.user_stats(user_id)
    reviews = await db.last_reviews(user_id)

    reg_date = datetime.fromisoformat(user["created_at"]).strftime("%d.%m.%Y")
    name = f"@{user['username']}" if user["username"] else escape(user["full_name"] or str(user_id))

    if stats["volumes"]:
        volume = ", ".join(
            f"{fmt_amount(v)} {asset}" for asset, v in stats["volumes"].items()
        )
    else:
        volume = "0"

    lines = [
        f"👤 <b>Профиль {escape(name)}</b>",
        f"├ ID: <code>{user_id}</code>",
        f"├ В сервисе с: {reg_date}",
        f"├ Завершённых сделок: <b>{stats['completed']}</b>",
        f"├ Оборот: {volume}",
        f"└ Репутация: {reputation_line(stats['positive'], stats['negative'])}",
    ]

    if reviews:
        lines.append("\n💬 <b>Последние отзывы:</b>")
        for r in reviews:
            emoji = "👍" if r["score"] > 0 else "👎"
            author = f"@{r['from_username']}" if r["from_username"] else "аноним"
            lines.append(f"{emoji} {escape(author)}: «{escape(r['comment'])}»")

    return "\n".join(lines)


@router.message(Command("profile"))
async def cmd_profile(message: Message, db: Database):
    await message.answer(await profile_text(db, message.from_user.id))


@router.callback_query(F.data == "menu:profile")
async def cb_profile(callback: CallbackQuery, db: Database):
    await callback.message.answer(await profile_text(db, callback.from_user.id))
    await callback.answer()


@router.message(Command("whois"))
async def cmd_whois(message: Message, db: Database):
    """Просмотр чужого профиля: /whois <id> — проверить контрагента перед сделкой."""
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip().isdigit():
        await message.answer("Использование: <code>/whois ID_пользователя</code>")
        return
    await message.answer(await profile_text(db, int(parts[1].strip())))
