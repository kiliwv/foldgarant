import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from bot.config import load_config
from bot.cryptopay import CryptoPay
from bot.db import Database
from bot.handlers import setup_routers
from bot.middlewares import BanMiddleware
from bot.watcher import watch_payments

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

COMMANDS = [
    BotCommand(command="start", description="Главное меню"),
    BotCommand(command="newdeal", description="Создать сделку"),
    BotCommand(command="mydeals", description="Мои активные сделки"),
    BotCommand(command="profile", description="Мой профиль и репутация"),
    BotCommand(command="whois", description="Профиль пользователя по ID"),
    BotCommand(command="help", description="Как это работает"),
]


async def main() -> None:
    config = load_config()

    db = Database(config.db_path)
    await db.connect()

    cp = CryptoPay(config.cryptopay_token, testnet=config.cryptopay_testnet)
    app_info = await cp.get_me()
    logger.info("Crypto Pay app: %s", app_info.get("name"))

    bot = Bot(config.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp["db"] = db
    dp["cp"] = cp
    dp["config"] = config

    dp.message.middleware(BanMiddleware(db))
    dp.callback_query.middleware(BanMiddleware(db))
    setup_routers(dp)

    await bot.set_my_commands(COMMANDS)

    watcher_task = asyncio.create_task(watch_payments(bot, db, cp))
    logger.info("Бот запущен")
    try:
        await dp.start_polling(bot)
    finally:
        watcher_task.cancel()
        await cp.close()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
