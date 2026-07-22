"""Фоновая задача: опрашивает Crypto Pay и переводит оплаченные сделки в холд."""

import asyncio
import logging

from aiogram import Bot

from . import db as d
from .cryptopay import CryptoPay
from .db import Database
from .keyboards import buyer_escrow_kb, seller_escrow_kb
from .services import notify
from .utils import fmt_amount

logger = logging.getLogger(__name__)

POLL_INTERVAL = 15  # секунд


async def watch_payments(bot: Bot, db: Database, cp: CryptoPay) -> None:
    while True:
        try:
            await _check_once(bot, db, cp)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Ошибка при проверке оплат")
        await asyncio.sleep(POLL_INTERVAL)


async def _check_once(bot: Bot, db: Database, cp: CryptoPay) -> None:
    deals = await db.deals_waiting_payment()
    if not deals:
        return
    by_invoice = {deal["invoice_id"]: deal for deal in deals}
    invoices = await cp.get_invoices(list(by_invoice.keys()))

    for invoice in invoices:
        if invoice.get("status") != "paid":
            continue
        deal = by_invoice.get(invoice["invoice_id"])
        if deal is None:
            continue
        # Перепроверяем статус, чтобы не обработать дважды
        fresh = await db.get_deal(deal["id"])
        if fresh is None or fresh["status"] != d.WAITING_PAYMENT:
            continue

        await db.set_status(deal["id"], d.PAID)
        logger.info("Сделка %s оплачена, средства в холде", deal["id"])

        amount = f"{fmt_amount(deal['amount'])} {deal['asset']}"
        await notify(
            bot, deal["buyer_id"],
            f"🔒 Оплата получена! <b>{amount}</b> по сделке #{deal['id']} "
            "заморожены у гаранта.\n\n"
            "Когда получите товар/услугу — подтвердите это кнопкой ниже, "
            "и деньги уйдут продавцу.",
            reply_markup=buyer_escrow_kb(deal["id"]),
        )
        await notify(
            bot, deal["seller_id"],
            f"🔒 Покупатель оплатил сделку #{deal['id']} — <b>{amount}</b> в холде у гаранта.\n\n"
            "Можете передавать товар/услугу. Деньги будут выплачены вам, "
            "как только покупатель подтвердит получение.",
            reply_markup=seller_escrow_kb(deal["id"]),
        )
