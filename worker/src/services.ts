// Общая бизнес-логика: выплаты, возвраты, уведомления сторон (порт bot/services.py).

import type { Ctx } from "./ctx";
import * as d from "./db";
import type { DealRow } from "./db";
import { CryptoPayError } from "./cryptopay";
import { buyerEscrowKb, rateKb, sellerEscrowKb } from "./keyboards";
import type { InlineKeyboardMarkup } from "./types";
import { fmtAmount, round8 } from "./utils";

export function payoutAmount(amount: number, commissionPercent: number): number {
  return round8(amount * (1 - commissionPercent / 100));
}

/** Отправляет личное сообщение. false — если пользователь не запускал бота. */
export async function notify(
  ctx: Ctx,
  userId: number | null,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<boolean> {
  if (userId === null) return false;
  try {
    await ctx.tg.sendMessage(userId, text, { reply_markup: replyMarkup });
    return true;
  } catch {
    console.warn(`Не удалось отправить сообщение пользователю ${userId}`);
    return false;
  }
}

export async function askRatings(ctx: Ctx, deal: DealRow): Promise<void> {
  const text =
    `⭐️ Оцените вашего контрагента по сделке <b>#${deal.id}</b>.\n` +
    "Оценка попадёт в его репутацию.";
  for (const uid of [deal.seller_id, deal.buyer_id]) {
    await notify(ctx, uid, text, rateKb(deal.id));
  }
}

/** Выплата продавцу из холда. initiator — 'buyer' или 'admin'. */
export async function releaseToSeller(
  ctx: Ctx,
  deal: DealRow,
  initiator: "buyer" | "admin",
): Promise<boolean> {
  const amount = payoutAmount(deal.amount, ctx.cfg.commissionPercent);
  try {
    // Без comment: Crypto Pay запрещает комментарии к небольшим переводам
    // (CANNOT_ATTACH_COMMENT), а стороны и так получают уведомление от бота.
    await ctx.cp.transfer({
      user_id: deal.seller_id!,
      asset: deal.asset,
      amount,
      spend_id: `payout_${deal.id}`,
    });
  } catch (e) {
    const name = e instanceof CryptoPayError ? e.errorName : String(e);
    console.error(`Ошибка выплаты по сделке ${deal.id}: ${name}`);
    for (const adminId of ctx.cfg.adminIds) {
      await notify(ctx, adminId, `🚨 Ошибка выплаты продавцу по сделке #${deal.id}: ${name}`);
    }
    return false;
  }

  await ctx.db.setStatus(deal.id, d.COMPLETED);
  const who =
    initiator === "buyer" ? "Покупатель подтвердил получение" : "Спор решён администратором";
  await notify(
    ctx,
    deal.seller_id,
    `✅ ${who}. Вам выплачено <b>${fmtAmount(amount)} ${deal.asset}</b> ` +
      `по сделке #${deal.id} (комиссия сервиса ${ctx.cfg.commissionPercent}%).\n` +
      "Средства зачислены на ваш баланс в @CryptoBot.",
  );
  await notify(
    ctx,
    deal.buyer_id,
    `✅ Сделка #${deal.id} завершена. Средства выплачены продавцу.`,
  );
  const fresh = await ctx.db.getDeal(deal.id);
  if (fresh) await askRatings(ctx, fresh);
  return true;
}

/** Возврат покупателю из холда. initiator — 'seller' или 'admin'. */
export async function refundToBuyer(
  ctx: Ctx,
  deal: DealRow,
  initiator: "seller" | "admin",
): Promise<boolean> {
  try {
    await ctx.cp.transfer({
      user_id: deal.buyer_id!,
      asset: deal.asset,
      amount: deal.amount,
      spend_id: `refund_${deal.id}`,
    });
  } catch (e) {
    const name = e instanceof CryptoPayError ? e.errorName : String(e);
    console.error(`Ошибка возврата по сделке ${deal.id}: ${name}`);
    for (const adminId of ctx.cfg.adminIds) {
      await notify(ctx, adminId, `🚨 Ошибка возврата покупателю по сделке #${deal.id}: ${name}`);
    }
    return false;
  }

  await ctx.db.setStatus(deal.id, d.REFUNDED);
  const who = initiator === "seller" ? "Продавец отменил сделку" : "Спор решён администратором";
  await notify(
    ctx,
    deal.buyer_id,
    `↩️ ${who}. Вам возвращено <b>${fmtAmount(deal.amount)} ${deal.asset}</b> ` +
      `по сделке #${deal.id}.\n` +
      "Средства зачислены на ваш баланс в @CryptoBot.",
  );
  await notify(
    ctx,
    deal.seller_id,
    `↩️ Сделка #${deal.id} закрыта, средства возвращены покупателю.`,
  );
  return true;
}

/**
 * Перевод оплаченной сделки в холд + уведомление сторон
 * (порт bot/watcher.py; вызывается из вебхука Crypto Pay и из cron-фолбэка).
 */
export async function markDealPaid(ctx: Ctx, dealId: string): Promise<void> {
  // Перепроверяем статус, чтобы не обработать дважды
  const deal = await ctx.db.getDeal(dealId);
  if (!deal || deal.status !== d.WAITING_PAYMENT) return;

  await ctx.db.setStatus(deal.id, d.PAID);
  console.log(`Сделка ${deal.id} оплачена, средства в холде`);

  const amount = `${fmtAmount(deal.amount)} ${deal.asset}`;
  await notify(
    ctx,
    deal.buyer_id,
    `🔒 Оплата получена! <b>${amount}</b> по сделке #${deal.id} ` +
      "заморожены у гаранта.\n\n" +
      "Когда получите товар/услугу — подтвердите это кнопкой ниже, " +
      "и деньги уйдут продавцу.",
    buyerEscrowKb(deal.id),
  );
  await notify(
    ctx,
    deal.seller_id,
    `🔒 Покупатель оплатил сделку #${deal.id} — <b>${amount}</b> в холде у гаранта.\n\n` +
      "Можете передавать товар/услугу. Деньги будут выплачены вам, " +
      "как только покупатель подтвердит получение.",
    sellerEscrowKb(deal.id),
  );
}

/** Cron-фолбэк: опрашивает Crypto Pay по всем сделкам, ждущим оплату. */
export async function checkPendingPayments(ctx: Ctx): Promise<void> {
  const deals = await ctx.db.dealsWaitingPayment();
  if (!deals.length) return;

  const byInvoice = new Map(deals.map((deal) => [deal.invoice_id!, deal]));
  const invoices = await ctx.cp.getInvoices([...byInvoice.keys()]);

  for (const invoice of invoices) {
    if (invoice.status !== "paid") continue;
    const deal = byInvoice.get(invoice.invoice_id);
    if (deal) await markDealPaid(ctx, deal.id);
  }
}
