// Форматирование карточек сделок и репутации, порт bot/utils.py.

import type { Ctx } from "./ctx";
import * as d from "./db";
import type { DealRow, UserRow } from "./db";

// Автоверификация: 100+ успешных сделок на сумму от 500 USDT
export const VERIFY_MIN_DEALS = 100;
export const VERIFY_MIN_VOLUME = 500;
// Бейджи (фолбэки не из карты emojify, чтобы не вложить tg-emoji друг в друга)
export const BADGE_VERIFIED = '<tg-emoji emoji-id="5956237062427382219">☑️</tg-emoji>';
export const BADGE_GOLD = '<tg-emoji emoji-id="5828192400727610571">👑</tg-emoji>';

/** Бейдж пользователя (с ведущим пробелом) или пустая строка. */
export async function userBadge(
  ctx: Ctx,
  userId: number | null,
  user?: UserRow | null,
): Promise<string> {
  if (userId === null) return "";
  const row = user ?? (await ctx.db.getUser(userId));
  if (ctx.cfg.adminIds.includes(userId) || (row?.is_gold ?? 0) === 1) return ` ${BADGE_GOLD}`;
  if ((row?.is_verified ?? 0) === 1) return ` ${BADGE_VERIFIED}`;
  const stats = await ctx.db.userStats(userId);
  const volume = Object.values(stats.volumes).reduce((a, b) => a + b, 0);
  if (stats.completed >= VERIFY_MIN_DEALS && volume >= VERIFY_MIN_VOLUME) {
    return ` ${BADGE_VERIFIED}`;
  }
  return "";
}

export const STATUS_LABELS: Record<string, string> = {
  [d.WAITING_PARTY]: "⏳ Ожидает второго участника",
  [d.WAITING_PAYMENT]: "💳 Ожидает оплату",
  [d.PAID]: "🔒 Деньги в холде у гаранта",
  [d.COMPLETED]: "✅ Завершена",
  [d.REFUNDED]: "↩️ Возврат покупателю",
  [d.DISPUTED]: "⚠️ Открыт спор",
  [d.CANCELLED]: "❌ Отменена",
};

export const STATUS_EMOJI: Record<string, string> = {
  [d.WAITING_PARTY]: "⏳",
  [d.WAITING_PAYMENT]: "💳",
  [d.PAID]: "🔒",
  [d.COMPLETED]: "✅",
  [d.REFUNDED]: "↩️",
  [d.DISPUTED]: "⚠️",
  [d.CANCELLED]: "❌",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtAmount(amount: number): string {
  return amount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function round8(x: number): number {
  return Math.round(x * 1e8) / 1e8;
}

export function mention(userId: number | null, username?: string | null): string {
  if (userId === null) return "—";
  if (username) return `@${escapeHtml(username)}`;
  return `<a href="tg://user?id=${userId}">пользователь ${userId}</a>`;
}

export async function userMention(ctx: Ctx, userId: number | null): Promise<string> {
  if (userId === null) return "—";
  const user = await ctx.db.getUser(userId);
  return mention(userId, user?.username ?? null) + (await userBadge(ctx, userId, user));
}

export async function dealCard(ctx: Ctx, deal: DealRow): Promise<string> {
  const seller = await userMention(ctx, deal.seller_id);
  const buyer = await userMention(ctx, deal.buyer_id);
  return (
    `🧾 <b>Сделка #${deal.id}</b>\n\n` +
    `├ Продавец: ${seller}\n` +
    `├ Покупатель: ${buyer}\n` +
    `├ Сумма: <b>${fmtAmount(deal.amount)} ${deal.asset}</b>\n` +
    `├ Условия: ${escapeHtml(deal.description)}\n` +
    `└ Статус: ${STATUS_LABELS[deal.status] ?? deal.status}`
  );
}

export function reputationLine(positive: number, negative: number): string {
  const total = positive + negative;
  if (total === 0) return "нет оценок";
  const percent = Math.round((positive / total) * 100);
  return `👍 ${positive} / 👎 ${negative} (${percent}% положительных)`;
}
