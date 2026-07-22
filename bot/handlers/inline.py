"""Inline-режим: создание сделки прямо в чате с собеседником.

Как @send у @CryptoBot: в любом чате пишете
    @имя_бота 25 USDT дизайн логотипа
выбираете свою роль — и в чат отправляется приглашение к сделке
с кнопкой «Присоединиться» для собеседника.

Требует включённого inline-режима у @BotFather:
/setinline и /setinlinefeedback -> Enabled (100%).
"""

import re
from html import escape

from aiogram import Bot, Router
from aiogram.types import (
    ChosenInlineResult,
    InlineQuery,
    InlineQueryResultArticle,
    InputTextMessageContent,
)

from ..config import Config
from ..db import Database
from ..keyboards import join_deal_kb, processing_kb
from ..utils import fmt_amount, mention

router = Router()

MAX_DESCRIPTION = 500

QUERY_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)(?:\s+(\S+))?(?:\s+(.*))?$", re.S)


def parse_query(text: str, config: Config) -> dict | None:
    """Разбирает строку вида «25 USDT описание» / «25 описание» / «25»."""
    m = QUERY_RE.match(text or "")
    if not m:
        return None
    try:
        amount = round(float(m.group(1).replace(",", ".")), 8)
    except ValueError:
        return None

    second = (m.group(2) or "").strip()
    rest = (m.group(3) or "").strip()
    if second.upper() in config.assets:
        asset = second.upper()
        description = rest
    else:
        asset = config.assets[0]
        description = f"{second} {rest}".strip()

    return {
        "amount": amount,
        "asset": asset,
        "description": description[:MAX_DESCRIPTION] or "Без описания",
    }


def _help_article(config: Config, note: str = "") -> InlineQueryResultArticle:
    bot_hint = "сумма [валюта] описание"
    return InlineQueryResultArticle(
        id="help",
        title=note or f"Формат: {bot_hint}",
        description=f"Например: 25 USDT дизайн логотипа • валюты: {', '.join(config.assets)}",
        input_message_content=InputTextMessageContent(
            message_text=(
                "ℹ️ <b>Как создать сделку прямо в чате</b>\n\n"
                f"Введите: <code>@имя_бота {bot_hint}</code>\n"
                "Например: <code>@имя_бота 25 USDT дизайн логотипа</code>\n"
                f"и выберите свою роль. Минимальная сумма: {fmt_amount(config.min_amount)}."
            ),
            parse_mode="HTML",
        ),
    )


@router.inline_query()
async def inline_new_deal(query: InlineQuery, config: Config):
    parsed = parse_query(query.query, config)
    if parsed is None:
        await query.answer([_help_article(config)], cache_time=5, is_personal=True)
        return
    if parsed["amount"] < config.min_amount:
        await query.answer(
            [_help_article(config, note=f"Минимальная сумма — {fmt_amount(config.min_amount)}")],
            cache_time=1, is_personal=True,
        )
        return

    amount_str = f"{fmt_amount(parsed['amount'])} {parsed['asset']}"
    placeholder = InputTextMessageContent(
        message_text=f"⏳ Создаю сделку на <b>{amount_str}</b>...",
        parse_mode="HTML",
    )
    results = [
        InlineQueryResultArticle(
            id="seller",
            title=f"🟠 Продаю за {amount_str}",
            description=f"Вы продавец: {parsed['description']}",
            input_message_content=placeholder,
            reply_markup=processing_kb(),
        ),
        InlineQueryResultArticle(
            id="buyer",
            title=f"🔵 Покупаю за {amount_str}",
            description=f"Вы покупатель: {parsed['description']}",
            input_message_content=placeholder,
            reply_markup=processing_kb(),
        ),
    ]
    await query.answer(results, cache_time=0, is_personal=True)


@router.chosen_inline_result()
async def inline_deal_chosen(
    chosen: ChosenInlineResult, db: Database, bot: Bot, config: Config
):
    if chosen.result_id not in ("seller", "buyer"):
        return
    if not chosen.inline_message_id:
        return
    parsed = parse_query(chosen.query, config)
    if parsed is None or parsed["amount"] < config.min_amount:
        return

    user = chosen.from_user
    await db.upsert_user(user.id, user.username, user.full_name)
    deal_id = await db.create_deal(
        creator_id=user.id,
        creator_role=chosen.result_id,
        asset=parsed["asset"],
        amount=parsed["amount"],
        description=parsed["description"],
    )

    role_creator = "продавец" if chosen.result_id == "seller" else "покупатель"
    role_free = "покупателя" if chosen.result_id == "seller" else "продавца"
    payout = round(parsed["amount"] * (1 - config.commission_percent / 100), 8)
    text = (
        f"🤝 <b>Приглашение в сделку #{deal_id}</b>\n\n"
        f"├ {mention(user.id, user.username)} — {role_creator}\n"
        f"├ Сумма: <b>{fmt_amount(parsed['amount'])} {parsed['asset']}</b>\n"
        f"├ Комиссия гаранта: {config.commission_percent}% "
        f"(продавец получит {fmt_amount(payout)} {parsed['asset']})\n"
        f"└ Описание: {escape(parsed['description'])}\n\n"
        f"🟢 Нажмите кнопку, чтобы присоединиться в роли <b>{role_free}</b>.\n"
        "Деньги покупателя хранятся у гаранта до подтверждения получения."
    )
    await bot.edit_message_text(
        text=text,
        inline_message_id=chosen.inline_message_id,
        reply_markup=join_deal_kb(deal_id),
    )
