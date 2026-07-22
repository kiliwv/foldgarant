// Форматирование карточек сделок и репутации, порт bot/utils.py.

import * as d from "./db";
import type { DealRow, Db } from "./db";

export const STATUS_LABELS: Record<string, string> = {
  [d.WAITING_PARTY]: "⏳ Ожидает второго участника",
  [d.WAITING_PAYMENT]: "💳 Ожидает оплату",
  [d.PAID]: "🔒 Деньги в холде у гаранта",
  [d.COMPLETED]: "✅ Завершена",
  [d.REFUNDED]: "↩️ Возврат покупателю",
  [d.DISPUTED]: "⚠️ Открыт спор",
  [d.CANCELLED]: "❌ Отменена",
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

export async function userMention(db: Db, userId: number | null): Promise<string> {
  if (userId === null) return "—";
  const user = await db.getUser(userId);
  return mention(userId, user?.username ?? null);
}

export async function dealCard(db: Db, deal: DealRow): Promise<string> {
  const seller = await userMention(db, deal.seller_id);
  const buyer = await userMention(db, deal.buyer_id);
  return (
    `🧾 <b>Сделка #${deal.id}</b>\n` +
    "<blockquote>" +
    `├ Продавец: ${seller}\n` +
    `├ Покупатель: ${buyer}\n` +
    `├ Сумма: <b>${fmtAmount(deal.amount)} ${deal.asset}</b>\n` +
    `├ Описание: ${escapeHtml(deal.description)}\n` +
    `└ Статус: ${STATUS_LABELS[deal.status] ?? deal.status}` +
    "</blockquote>"
  );
}

export function reputationLine(positive: number, negative: number): string {
  const total = positive + negative;
  if (total === 0) return "нет оценок";
  const percent = Math.round((positive / total) * 100);
  return `👍 ${positive} / 👎 ${negative} (${percent}% положительных)`;
}
