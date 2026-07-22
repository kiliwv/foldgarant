"""Общая бизнес-логика: выплаты, возвраты, уведомления сторон."""

import logging

from aiogram import Bot

from . import db as d
from .config import Config
from .cryptopay import CryptoPay, CryptoPayError
from .db import Database
from .keyboards import rate_kb
from .utils import fmt_amount

logger = logging.getLogger(__name__)


def payout_amount(amount: float, commission_percent: float) -> float:
    return round(amount * (1 - commission_percent / 100), 8)


async def notify(bot: Bot, user_id: int | None, text: str, **kwargs) -> bool:
    """Отправляет личное сообщение. False — если пользователь не запускал бота."""
    if user_id is None:
        return False
    try:
        await bot.send_message(user_id, text, **kwargs)
        return True
    except Exception:
        logger.warning("Не удалось отправить сообщение пользователю %s", user_id)
        return False


async def ask_ratings(bot: Bot, deal) -> None:
    text = (
        f"⭐️ Оцените вашего контрагента по сделке <b>#{deal['id']}</b>.\n"
        "Оценка попадёт в его репутацию."
    )
    for uid in (deal["seller_id"], deal["buyer_id"]):
        await notify(bot, uid, text, reply_markup=rate_kb(deal["id"]))


async def release_to_seller(
    bot: Bot, db: Database, cp: CryptoPay, config: Config, deal, initiator: str
) -> bool:
    """Выплата продавцу из холда. initiator — 'buyer' или 'admin'."""
    amount = payout_amount(deal["amount"], config.commission_percent)
    try:
        await cp.transfer(
            user_id=deal["seller_id"],
            asset=deal["asset"],
            amount=amount,
            spend_id=f"payout_{deal['id']}",
            comment=f"Выплата по сделке #{deal['id']}",
        )
    except CryptoPayError as e:
        logger.error("Ошибка выплаты по сделке %s: %s", deal["id"], e)
        for admin_id in config.admin_ids:
            await notify(
                bot, admin_id,
                f"🚨 Ошибка выплаты продавцу по сделке #{deal['id']}: {e.name}",
            )
        return False

    await db.set_status(deal["id"], d.COMPLETED)
    who = "Покупатель подтвердил получение" if initiator == "buyer" else "Спор решён администратором"
    await notify(
        bot, deal["seller_id"],
        f"✅ {who}. Вам выплачено <b>{fmt_amount(amount)} {deal['asset']}</b> "
        f"по сделке #{deal['id']} (комиссия сервиса {config.commission_percent}%).\n"
        "Средства зачислены на ваш баланс в @CryptoBot.",
    )
    await notify(
        bot, deal["buyer_id"],
        f"✅ Сделка #{deal['id']} завершена. Средства выплачены продавцу.",
    )
    deal = await db.get_deal(deal["id"])
    await ask_ratings(bot, deal)
    return True


async def refund_to_buyer(
    bot: Bot, db: Database, cp: CryptoPay, config: Config, deal, initiator: str
) -> bool:
    """Возврат покупателю из холда. initiator — 'seller' или 'admin'."""
    try:
        await cp.transfer(
            user_id=deal["buyer_id"],
            asset=deal["asset"],
            amount=deal["amount"],
            spend_id=f"refund_{deal['id']}",
            comment=f"Возврат по сделке #{deal['id']}",
        )
    except CryptoPayError as e:
        logger.error("Ошибка возврата по сделке %s: %s", deal["id"], e)
        for admin_id in config.admin_ids:
            await notify(
                bot, admin_id,
                f"🚨 Ошибка возврата покупателю по сделке #{deal['id']}: {e.name}",
            )
        return False

    await db.set_status(deal["id"], d.REFUNDED)
    who = "Продавец отменил сделку" if initiator == "seller" else "Спор решён администратором"
    await notify(
        bot, deal["buyer_id"],
        f"↩️ {who}. Вам возвращено <b>{fmt_amount(deal['amount'])} {deal['asset']}</b> "
        f"по сделке #{deal['id']}.\n"
        "Средства зачислены на ваш баланс в @CryptoBot.",
    )
    await notify(
        bot, deal["seller_id"],
        f"↩️ Сделка #{deal['id']} закрыта, средства возвращены покупателю.",
    )
    return True
