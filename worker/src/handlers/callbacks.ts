// Обработка callback-кнопок (порт callback-хендлеров bot/handlers/*.py).

import type { Ctx } from "../ctx";
import * as d from "../db";
import { CryptoPayError } from "../cryptopay";
import {
  assetKb,
  backKb,
  buyerEscrowKb,
  cancelDealKb,
  confirmReleaseKb,
  disputeResolveKb,
  mainMenu,
  payKb,
} from "../keyboards";
import { notify, refundToBuyer, releaseToSeller } from "../services";
import type { InlineKeyboardMarkup, TgCallbackQuery } from "../types";
import { fullName } from "../types";
import { dealCard, fmtAmount } from "../utils";
import {
  HELP_TEXT,
  ST_NEWDEAL_ASSET,
  ST_NEWDEAL_AMOUNT,
  ST_NEWDEAL_CONFIRM,
  ST_NEWDEAL_ROLE,
  ST_RATE_COMMENT,
  ST_SEARCH,
  WELCOME,
  profileText,
  sendMyDeals,
  startNewDeal,
} from "./messages";

/** Редактирует сообщение с кнопкой: обычное или inline (в чужом чате). */
async function editSource(
  ctx: Ctx,
  cb: TgCallbackQuery,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  if (cb.message) {
    await ctx.tg.editMessageText({
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text,
      reply_markup: replyMarkup,
    });
  } else if (cb.inline_message_id) {
    await ctx.tg.editMessageText({
      inline_message_id: cb.inline_message_id,
      text,
      reply_markup: replyMarkup,
    });
  }
}

export async function handleCallback(ctx: Ctx, cb: TgCallbackQuery): Promise<void> {
  const data = cb.data ?? "";
  const user = cb.from;
  const answer = (text?: string, alert = false) =>
    ctx.tg.answerCallbackQuery(cb.id, text, alert).catch(() => {});

  // --- Главное меню ---------------------------------------------------------

  if (data === "menu:back") {
    await ctx.db.clearState(user.id);
    await editSource(ctx, cb, WELCOME, mainMenu());
    await answer();
    return;
  }

  if (data === "menu:help") {
    if (cb.message) {
      await ctx.tg.sendMessage(cb.message.chat.id, HELP_TEXT, { reply_markup: backKb() });
    }
    await answer();
    return;
  }

  if (data === "menu:profile") {
    if (cb.message) {
      await ctx.tg.sendMessage(cb.message.chat.id, await profileText(ctx, user.id), {
        reply_markup: backKb(),
      });
    }
    await answer();
    return;
  }

  if (data === "menu:search") {
    await ctx.db.setState(user.id, ST_SEARCH, {});
    if (cb.message) {
      await ctx.tg.sendMessage(
        cb.message.chat.id,
        "🔍 Введите @юзернейм или ID пользователя для поиска.",
        { reply_markup: backKb() },
      );
    }
    await answer();
    return;
  }

  if (data === "menu:newdeal") {
    await ctx.db.upsertUser(user.id, user.username ?? null, fullName(user));
    if (cb.message) await startNewDeal(ctx, cb.message.chat.id, user.id);
    await answer();
    return;
  }

  if (data === "menu:mydeals") {
    if (cb.message) await sendMyDeals(ctx, cb.message.chat.id, user.id);
    await answer();
    return;
  }

  // --- Создание сделки (FSM) ------------------------------------------------

  if (data === "newdeal:cancel") {
    await ctx.db.clearState(user.id);
    await editSource(ctx, cb, "❌ Создание сделки отменено.");
    if (cb.message) {
      await ctx.tg.sendMessage(cb.message.chat.id, "Главное меню:", { reply_markup: mainMenu() });
    }
    await answer();
    return;
  }

  if (data.startsWith("role:")) {
    const { state, data: fsm } = await ctx.db.getState(user.id);
    if (state !== ST_NEWDEAL_ROLE) {
      await answer();
      return;
    }
    const role = data.split(":")[1];
    await ctx.db.setState(user.id, ST_NEWDEAL_ASSET, { ...fsm, role });
    await editSource(ctx, cb, "💱 Выберите валюту сделки:", assetKb(ctx.cfg.assets));
    await answer();
    return;
  }

  if (data.startsWith("asset:")) {
    const { state, data: fsm } = await ctx.db.getState(user.id);
    if (state !== ST_NEWDEAL_ASSET) {
      await answer();
      return;
    }
    const asset = data.split(":")[1];
    if (!ctx.cfg.assets.includes(asset)) {
      await answer("Недоступная валюта", true);
      return;
    }
    await ctx.db.setState(user.id, ST_NEWDEAL_AMOUNT, { ...fsm, asset });
    await editSource(
      ctx,
      cb,
      `💰 Введите сумму сделки в <b>${asset}</b> ` +
        `(минимум ${fmtAmount(ctx.cfg.minAmount)}):`,
    );
    await answer();
    return;
  }

  if (data === "newdeal:confirm") {
    const { state, data: fsm } = await ctx.db.getState(user.id);
    if (state !== ST_NEWDEAL_CONFIRM) {
      await answer();
      return;
    }
    await ctx.db.clearState(user.id);
    const dealId = await ctx.db.createDeal(
      user.id,
      fsm.role as "seller" | "buyer",
      fsm.asset as string,
      fsm.amount as number,
      fsm.description as string,
    );
    const me = await ctx.tg.getMe();
    const link = `https://t.me/${me.username}?start=deal_${dealId}`;
    await editSource(
      ctx,
      cb,
      `✅ <b>Сделка #${dealId} создана!</b>\n\n` +
        "Отправьте эту ссылку второму участнику:\n" +
        `${link}\n\n` +
        "Как только он присоединится, я пришлю счёт покупателю.",
      cancelDealKb(dealId),
    );
    await answer();
    return;
  }

  // --- Присоединение и оплата -----------------------------------------------

  if (data === "noop") {
    await answer("⏳ Сделка ещё создаётся, попробуйте через секунду.");
    return;
  }

  if (data.startsWith("deal:join:")) {
    const dealId = data.split(":")[2];
    let deal = await ctx.db.getDeal(dealId);

    if (!deal || deal.status !== d.WAITING_PARTY) {
      await answer("К этой сделке уже нельзя присоединиться.", true);
      return;
    }
    if (user.id === deal.creator_id) {
      await answer("Нельзя присоединиться к собственной сделке.", true);
      return;
    }

    await ctx.db.upsertUser(user.id, user.username ?? null, fullName(user));
    await ctx.db.joinDeal(dealId, user.id);
    deal = (await ctx.db.getDeal(dealId))!;

    // Выставляем счёт покупателю
    let invoice;
    try {
      invoice = await ctx.cp.createInvoice({
        asset: deal.asset,
        amount: deal.amount,
        description: `Сделка #${dealId}: ${deal.description.slice(0, 100)}`,
        payload: dealId,
      });
    } catch (e) {
      const name = e instanceof CryptoPayError ? e.errorName : "UNKNOWN";
      await answer(`Ошибка создания счёта: ${name}`, true);
      return;
    }

    await ctx.db.setInvoice(dealId, invoice.invoice_id, invoice.bot_invoice_url);
    const card = await dealCard(ctx.db, (await ctx.db.getDeal(dealId))!);

    await notify(ctx, deal.creator_id, `🤝 Второй участник присоединился к сделке!\n\n${card}`);

    const payText =
      `💳 <b>Счёт на оплату сделки #${dealId}</b>\n\n` +
      `Сумма: <b>${fmtAmount(deal.amount)} ${deal.asset}</b>\n` +
      "Оплатите через @CryptoBot — средства будут храниться у гаранта " +
      "до подтверждения получения товара/услуги.";
    const invoiceSent = await notify(
      ctx,
      deal.buyer_id,
      payText,
      payKb(invoice.bot_invoice_url, dealId),
    );

    const me = await ctx.tg.getMe();
    let text = `🤝 Второй участник присоединился!\n\n${card}`;
    if (invoiceSent) {
      text += "\n\n💳 Счёт на оплату отправлен покупателю в личные сообщения.";
    } else {
      text +=
        `\n\n⚠️ Покупатель, откройте @${me.username}, нажмите Start ` +
        "и оплатите счёт в разделе /mydeals.";
    }
    await editSource(ctx, cb, text);

    if (!invoiceSent && user.id === deal.buyer_id) {
      await answer(
        `Откройте @${me.username} и нажмите Start — там ждёт счёт на оплату (/mydeals).`,
        true,
      );
    } else {
      await answer("Вы присоединились к сделке!");
    }
    return;
  }

  // --- Отмена до оплаты -----------------------------------------------------

  if (data.startsWith("deal:cancel:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal) {
      await answer("Сделка не найдена.", true);
      return;
    }
    if (![deal.seller_id, deal.buyer_id, deal.creator_id].includes(user.id)) {
      await answer("Вы не участник этой сделки.", true);
      return;
    }
    if (deal.status !== d.WAITING_PARTY && deal.status !== d.WAITING_PAYMENT) {
      await answer("Сделку нельзя отменить после оплаты. Откройте спор.", true);
      return;
    }

    await ctx.db.setStatus(dealId, d.CANCELLED);
    await editSource(ctx, cb, `❌ Сделка #${dealId} отменена.`);
    const others = new Set([deal.seller_id, deal.buyer_id, deal.creator_id]);
    others.delete(null);
    others.delete(user.id);
    for (const uid of others) {
      await notify(ctx, uid, `❌ Сделка #${dealId} отменена вторым участником.`);
    }
    await answer();
    return;
  }

  // --- Действия в холде -----------------------------------------------------

  if (data.startsWith("deal:release:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.PAID) {
      await answer("Действие недоступно для этой сделки.", true);
      return;
    }
    if (user.id !== deal.buyer_id) {
      await answer("Подтвердить получение может только покупатель.", true);
      return;
    }
    await editSource(
      ctx,
      cb,
      `❗️ Вы подтверждаете, что получили товар/услугу по сделке #${dealId}?\n` +
        "После подтверждения деньги будут <b>сразу выплачены продавцу</b> — " +
        "отменить это действие невозможно.",
      confirmReleaseKb(dealId),
    );
    await answer();
    return;
  }

  if (data.startsWith("deal:back:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.PAID) {
      await answer();
      return;
    }
    const card = await dealCard(ctx.db, deal);
    await editSource(ctx, cb, card, buyerEscrowKb(dealId));
    await answer();
    return;
  }

  if (data.startsWith("deal:release2:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.PAID) {
      await answer("Действие недоступно для этой сделки.", true);
      return;
    }
    if (user.id !== deal.buyer_id) {
      await answer("Подтвердить получение может только покупатель.", true);
      return;
    }

    await editSource(ctx, cb, `⏳ Выплачиваю средства продавцу по сделке #${dealId}...`);
    const ok = await releaseToSeller(ctx, deal, "buyer");
    if (!ok) {
      await editSource(
        ctx,
        cb,
        `🚨 Не удалось выполнить выплату по сделке #${dealId}. ` +
          "Администраторы уведомлены и разберутся вручную.",
      );
    }
    await answer();
    return;
  }

  if (data.startsWith("deal:refund:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.PAID) {
      await answer("Действие недоступно для этой сделки.", true);
      return;
    }
    if (user.id !== deal.seller_id) {
      await answer("Вернуть деньги может только продавец.", true);
      return;
    }

    await editSource(ctx, cb, `⏳ Возвращаю средства покупателю по сделке #${dealId}...`);
    const ok = await refundToBuyer(ctx, deal, "seller");
    if (!ok) {
      await editSource(
        ctx,
        cb,
        `🚨 Не удалось выполнить возврат по сделке #${dealId}. ` +
          "Администраторы уведомлены и разберутся вручную.",
      );
    }
    await answer();
    return;
  }

  // --- Спор -----------------------------------------------------------------

  if (data.startsWith("deal:dispute:")) {
    const dealId = data.split(":")[2];
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.PAID) {
      await answer("Спор можно открыть только по оплаченной сделке.", true);
      return;
    }
    if (user.id !== deal.seller_id && user.id !== deal.buyer_id) {
      await answer("Вы не участник этой сделки.", true);
      return;
    }

    await ctx.db.setStatus(dealId, d.DISPUTED);
    const card = await dealCard(ctx.db, (await ctx.db.getDeal(dealId))!);

    await editSource(
      ctx,
      cb,
      `⚠️ По сделке #${dealId} открыт спор. Администратор рассмотрит его и примет решение.\n\n` +
        "Опишите ситуацию и пришлите доказательства администратору, когда он свяжется с вами.",
    );
    const other = user.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;
    await notify(
      ctx,
      other,
      `⚠️ По сделке #${dealId} второй участник открыл спор. ` +
        "Администратор рассмотрит его и примет решение.",
    );
    if (!ctx.cfg.adminIds.length) {
      await answer("Внимание: в конфиге не заданы администраторы!", true);
      return;
    }
    for (const adminId of ctx.cfg.adminIds) {
      await notify(
        ctx,
        adminId,
        `⚠️ <b>Новый спор!</b> Открыл: ${user.id} (@${user.username ?? "—"})\n\n${card}`,
        disputeResolveKb(dealId),
      );
    }
    await answer();
    return;
  }

  // --- Оценки ---------------------------------------------------------------

  if (data === "rate:skip_comment") {
    await ctx.db.clearState(user.id);
    await editSource(ctx, cb, "✅ Спасибо! Оценка сохранена.");
    await answer();
    return;
  }

  if (data.startsWith("rate:")) {
    const [, dealId, scoreStr] = data.split(":");
    const score = parseInt(scoreStr, 10);
    const deal = await ctx.db.getDeal(dealId);

    if (!deal || (deal.status !== d.COMPLETED && deal.status !== d.REFUNDED)) {
      await answer("Оценивать можно только завершённые сделки.", true);
      return;
    }
    if (user.id !== deal.seller_id && user.id !== deal.buyer_id) {
      await answer("Вы не участник этой сделки.", true);
      return;
    }

    const toUser = user.id === deal.buyer_id ? deal.seller_id! : deal.buyer_id!;
    const created = await ctx.db.addRating(dealId, user.id, toUser, score);
    if (!created) {
      await answer("Вы уже оценили эту сделку.", true);
      return;
    }

    const emoji = score > 0 ? "👍" : "👎";
    await ctx.db.setState(user.id, ST_RATE_COMMENT, { rate_deal_id: dealId });
    await editSource(
      ctx,
      cb,
      `${emoji} Оценка сохранена!\n\n` +
        "💬 Хотите оставить текстовый отзыв? Отправьте его сообщением " +
        `(до 300 символов) или пропустите.`,
      { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: "rate:skip_comment" }]] },
    );
    await answer();
    return;
  }

  // --- Решение споров администратором ---------------------------------------

  if (data.startsWith("resolve:")) {
    if (!ctx.cfg.adminIds.includes(user.id)) {
      await answer("Только для администраторов.", true);
      return;
    }
    const [, action, dealId] = data.split(":");
    const deal = await ctx.db.getDeal(dealId);
    if (!deal || deal.status !== d.DISPUTED) {
      await answer("Спор по этой сделке уже закрыт.", true);
      return;
    }

    await editSource(ctx, cb, `⏳ Закрываю спор по сделке #${dealId}...`);
    let result: string;
    if (action === "release") {
      const ok = await releaseToSeller(ctx, deal, "admin");
      result = ok ? "выплачены продавцу" : "ОШИБКА выплаты";
    } else {
      const ok = await refundToBuyer(ctx, deal, "admin");
      result = ok ? "возвращены покупателю" : "ОШИБКА возврата";
    }
    await editSource(ctx, cb, `⚖️ Спор по сделке #${dealId}: средства ${result}.`);
    await answer();
    return;
  }

  await answer();
}
