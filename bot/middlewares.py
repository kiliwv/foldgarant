from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

from .db import Database


class BanMiddleware(BaseMiddleware):
    """Не пускает заблокированных пользователей дальше по хендлерам."""

    def __init__(self, db: Database):
        self.db = db

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = None
        if isinstance(event, (Message, CallbackQuery)):
            user = event.from_user
        if user is not None:
            row = await self.db.get_user(user.id)
            if row is not None and row["is_banned"]:
                if isinstance(event, CallbackQuery):
                    await event.answer("🚫 Вы заблокированы в сервисе.", show_alert=True)
                elif isinstance(event, Message):
                    await event.answer("🚫 Вы заблокированы в сервисе.")
                return None
        return await handler(event, data)
