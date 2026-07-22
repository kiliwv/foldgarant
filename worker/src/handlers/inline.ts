// Inline-режим: создание сделки прямо в чате с собеседником
// (порт bot/handlers/inline.py).
//
// Как @send у @CryptoBot: в любом чате пишете
//     @имя_бота 25 USDT дизайн логотипа
// выбираете свою роль — и в чат отправляется приглашение к сделке
// с кнопкой «Присоединиться» для собеседника.
//
// Требует включённого inline-режима у @BotFather:
// /setinline и /setinlinefeedback -> Enabled (100%).

import type { Config } from "../config";
import type { Ctx } from "../ctx";
import { emojify } from "../custom-emoji";
import { joinDealKb, processingKb } from "../keyboards";
import type { TgChosenInlineResult, TgInlineQuery } from "../types";
import { fullName } from "../types";
import { escapeHtml, fmtAmount, mention, round8 } from "../utils";

const MAX_DESCRIPTION = 500;

const QUERY_RE = /^\s*(\d+(?:[.,]\d+)?)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/;

interface ParsedQuery {
  amount: number;
  asset: string;
  description: string;
}

/** Разбирает строку вида «25 USDT описание» / «25 описание» / «25». */
export function parseQuery(text: string, cfg: Config): ParsedQuery | null {
  const m = QUERY_RE.exec(text ?? "");
  if (!m) return null;
  const amount = round8(parseFloat(m[1].replace(",", ".")));
  if (Number.isNaN(amount)) return null;

  const second = (m[2] ?? "").trim();
  const rest = (m[3] ?? "").trim();
  let asset: string;
  let description: string;
  if (cfg.assets.includes(second.toUpperCase())) {
    asset = second.toUpperCase();
    description = rest;
  } else {
    asset = cfg.assets[0];
    description = `${second} ${rest}`.trim();
  }

  // Условия сделки обязательны — без них результат не предлагается
  return {
    amount,
    asset,
    description: description.slice(0, MAX_DESCRIPTION),
  };
}

function thumb(origin: string | undefined, name: string) {
  return origin ? { thumbnail_url: `${origin}/icons/${name}.png` } : {};
}

function helpArticle(cfg: Config, origin?: string, note = ""): Record<string, unknown> {
  const botHint = "сумма условия сделки";
  return {
    type: "article",
    id: "help",
    title: note || `Формат: ${botHint}`,
    description: `Например: 25 дизайн логотипа до пятницы • условия обязательны`,
    ...thumb(origin, "help"),
    input_message_content: {
      message_text: emojify(
        "ℹ️ <b>Как создать сделку прямо в чате</b>\n\n" +
          `Введите: <code>@имя_бота ${botHint}</code>\n` +
          "Например: <code>@имя_бота 25 дизайн логотипа до пятницы</code>\n" +
          "и выберите свою роль. Условия сделки обязательны. " +
          `Минимальная сумма: ${fmtAmount(cfg.minAmount)}.`,
      ),
      parse_mode: "HTML",
    },
  };
}

export async function handleInlineQuery(ctx: Ctx, query: TgInlineQuery): Promise<void> {
  const parsed = parseQuery(query.query, ctx.cfg);
  if (!parsed) {
    await ctx.tg.answerInlineQuery(query.id, [helpArticle(ctx.cfg, ctx.origin)], {
      cache_time: 5,
      is_personal: true,
    });
    return;
  }
  if (parsed.amount < ctx.cfg.minAmount) {
    await ctx.tg.answerInlineQuery(
      query.id,
      [helpArticle(ctx.cfg, ctx.origin, `Минимальная сумма — ${fmtAmount(ctx.cfg.minAmount)}`)],
      { cache_time: 1, is_personal: true },
    );
    return;
  }
  if (!parsed.description) {
    await ctx.tg.answerInlineQuery(
      query.id,
      [helpArticle(ctx.cfg, ctx.origin, "Допишите условия сделки — они обязательны")],
      { cache_time: 1, is_personal: true },
    );
    return;
  }

  const amountStr = `${fmtAmount(parsed.amount)} ${parsed.asset}`;
  const placeholder = {
    message_text: emojify(`⏳ Создаю сделку на <b>${amountStr}</b>...`),
    parse_mode: "HTML",
  };
  const results = [
    {
      type: "article",
      id: "seller",
      title: `Продаю за ${amountStr}`,
      description: `Вы продавец: ${parsed.description}`,
      input_message_content: placeholder,
      reply_markup: processingKb(),
      ...thumb(ctx.origin, "seller"),
    },
    {
      type: "article",
      id: "buyer",
      title: `Покупаю за ${amountStr}`,
      description: `Вы покупатель: ${parsed.description}`,
      input_message_content: placeholder,
      reply_markup: processingKb(),
      ...thumb(ctx.origin, "buyer"),
    },
  ];
  await ctx.tg.answerInlineQuery(query.id, results, { cache_time: 0, is_personal: true });
}

export async function handleChosenInlineResult(
  ctx: Ctx,
  chosen: TgChosenInlineResult,
): Promise<void> {
  if (chosen.result_id !== "seller" && chosen.result_id !== "buyer") return;
  if (!chosen.inline_message_id) return;
  const parsed = parseQuery(chosen.query, ctx.cfg);
  if (!parsed || parsed.amount < ctx.cfg.minAmount || !parsed.description) return;

  const user = chosen.from;
  await ctx.db.upsertUser(user.id, user.username ?? null, fullName(user));
  const dealId = await ctx.db.createDeal(
    user.id,
    chosen.result_id,
    parsed.asset,
    parsed.amount,
    parsed.description,
  );
  // Запоминаем сообщение в чате — оно станет живой карточкой сделки
  await ctx.db.setInlineMsgId(dealId, chosen.inline_message_id);

  const roleCreator = chosen.result_id === "seller" ? "продавец" : "покупатель";
  const roleFree = chosen.result_id === "seller" ? "покупателя" : "продавца";
  const payout = round8(parsed.amount * (1 - ctx.cfg.commissionPercent / 100));
  const text =
    `🤝 <b>Приглашение в сделку #${dealId}</b>\n\n` +
    `├ ${mention(user.id, user.username)} — ${roleCreator}\n` +
    `├ Сумма: <b>${fmtAmount(parsed.amount)} ${parsed.asset}</b>\n` +
    `├ Комиссия гаранта: ${ctx.cfg.commissionPercent}% ` +
    `(продавец получит ${fmtAmount(payout)} ${parsed.asset})\n` +
    `└ Условия: ${escapeHtml(parsed.description)}\n\n` +
    `🟢 Нажмите кнопку, чтобы присоединиться в роли <b>${roleFree}</b>.\n` +
    "Деньги покупателя хранятся у гаранта до подтверждения получения.";
  await ctx.tg.editMessageText({
    inline_message_id: chosen.inline_message_id,
    text,
    reply_markup: joinDealKb(dealId),
  });
}
