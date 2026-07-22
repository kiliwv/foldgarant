// Обработка callback-кнопок (порт callback-хендлеров bot/handlers/*.py).

import type { Ctx } from "../ctx";
import * as d from "../db";
import { CryptoPayError } from "../cryptopay";
import {
  adminDealKb,
  assetKb,
  backKb,
  buyerEscrowKb,
  cancelDealKb,
  confirmReleaseKb,
  disputeResolveKb,
  mainMenu,
  payKb,
  walletKb,
} from "../keyboards";
import { notify, refundToBuyer, releaseToSeller } from "../services";
import { round8 } from "../utils";
import type { InlineKeyboardMarkup, TgCallbackQuery } from "../types";
import { fullName } from "../types";
import { dealCard, fmtAmount } from "../utils";
import {
  HELP_TEXT,
  ST_NEWDEAL_ASSET,
  ST_NEWDEAL_AMOUNT,
  ST_NEWDEAL_CONFIRM,
  ST_NEWDEAL_ROLE,
  ST_RATE_SCREENSHOT,
  ST_SEARCH,
  WELCOME,
  adminPanel,
  balanceText,
  profileText,
  sendMyDeals,
  startNewDeal,
  walletView,
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

  if (data === "menu:wallet") {
    if (cb.message) {
      const wallet = await walletView(ctx, user.id);
      await ctx.tg.sendMessage(cb.message.chat.id, wallet.text, {
        reply_markup: walletKb(wallet.hasFunds),
      });
    }
    await answer();
    return;
  }

  if (data === "wallet:withdraw") {
    const balances = await ctx.db.getBalances(user.id);
    if (!balances.length) {
      await answer("Баланс пуст.", true);
      return;
    }
    await editSource(ctx, cb, "⏳ Вывожу средства...");
    const cryptoBot = ctx.cfg.cryptopayTestnet ? "@CryptoTestnetBot" : "@CryptoBot";
    const lines: string[] = [];
    for (const b of balances) {
      const target = round8(b.total_out + b.amount);
      try {
        await ctx.cp.transfer({
          user_id: user.id,
          asset: b.asset,
          amount: b.amount,
          spend_id: `wd_${user.id}_${b.asset}_${target}`,
        });
        await ctx.db.settleWithdrawal(user.id, b.asset, target);
        lines.push(`✅ ${fmtAmount(b.amount)} ${b.asset} отправлены на ваш баланс в ${cryptoBot}.`);
      } catch (e) {
        const name = e instanceof CryptoPayError ? e.errorName : String(e);
        let hint = "";
        if (name === "USER_NOT_FOUND") {
          hint = ` Откройте ${cryptoBot}, нажмите Start и повторите вывод.`;
        }
        lines.push(`❌ ${b.asset}: вывод не прошёл (${name}).${hint}`);
      }
    }
    await editSource(ctx, cb, `💼 <b>Вывод средств</b>\n\n${lines.join("\n")}`, backKb());
    await answer();
    return;
  }

  if (data === "menu:search") {
    await ctx.db.setState(user.id, ST_SEARCH, {});
    if (cb.message) {
      await ctx.tg.sendMessage(
        cb.message.chat.id,
        "🔍 <b>Поиск</b>\n\nВведите @юзернейм или ID пользователя для поиска.",
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
    if (ctx.cfg.assets.length === 1) {
      // Валюта одна — шаг выбора не нужен, сразу просим сумму.
      const asset = ctx.cfg.assets[0];
      await ctx.db.setState(user.id, ST_NEWDEAL_AMOUNT, { ...fsm, role, asset });
      await editSource(
        ctx,
        cb,
        `💰 <b>Введите сумму сделки в ${asset}</b>\n\n` +
          `Минимум: ${fmtAmount(ctx.cfg.minAmount)} ${asset}\n` +
          "Пример: <code>50</code> или <code>12.5</code>",
      );
    } else {
      await ctx.db.setState(user.id, ST_NEWDEAL_ASSET, { ...fsm, role });
      await editSource(ctx, cb, "💱 Выберите валюту сделки:", assetKb(ctx.cfg.assets));
    }
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
    if (await ctx.db.hasRating(dealId, user.id)) {
      await answer("Вы уже оценили эту сделку.", true);
      return;
    }

    const emoji = score > 0 ? "👍" : "👎";
    await ctx.db.setState(user.id, ST_RATE_SCREENSHOT, {
      rate_deal_id: dealId,
      rate_score: score,
    });
    await editSource(
      ctx,
      cb,
      `${emoji} Оценка принята — остался один шаг.\n\n` +
        "📸 Пришлите <b>скриншот вашей переписки</b> по этой сделке (фото). " +
        "Оценка засчитается после автоматической проверки — это защита " +
        "репутации от накруток.",
      backKb(),
    );
    await answer();
    return;
  }

  // --- Админ-панель ----------------------------------------------------------

  if (data === "adm:panel" || data.startsWith("adm:")) {
    if (!ctx.cfg.adminIds.includes(user.id)) {
      await answer("Только для администраторов.", true);
      return;
    }

    if (data === "adm:panel") {
      const panel = await adminPanel(ctx);
      await editSource(ctx, cb, panel.text, panel.kb);
      await answer("Обновлено");
      return;
    }

    if (data === "adm:balance") {
      if (cb.message) {
        await ctx.tg.sendMessage(cb.message.chat.id, await balanceText(ctx));
      }
      await answer();
      return;
    }

    if (data.startsWith("adm:list:")) {
      const status = data.split(":")[2];
      if (![d.DISPUTED, d.PAID, d.WAITING_PAYMENT, d.WAITING_PARTY].includes(status)) {
        await answer();
        return;
      }
      const deals = await ctx.db.dealsByStatus(status, 10);
      if (!deals.length) {
        await answer("Таких сделок нет.", true);
        return;
      }
      if (cb.message) {
        for (const deal of deals) {
          const card = await dealCard(ctx.db, deal);
          await ctx.tg.sendMessage(cb.message.chat.id, card, {
            reply_markup: adminDealKb(deal.id, deal.status),
          });
        }
      }
      await answer(`Показано: ${deals.length}`);
      return;
    }

    if (data.startsWith("adm:release:") || data.startsWith("adm:refund:")) {
      const [, action, dealId] = data.split(":");
      const deal = await ctx.db.getDeal(dealId);
      if (!deal || (deal.status !== d.PAID && deal.status !== d.DISPUTED)) {
        await answer("Сделка уже закрыта или не оплачена.", true);
        return;
      }
      await editSource(
        ctx,
        cb,
        action === "release"
          ? `⏳ Выплачиваю средства продавцу по сделке #${dealId}...`
          : `⏳ Возвращаю средства покупателю по сделке #${dealId}...`,
      );
      const ok =
        action === "release"
          ? await releaseToSeller(ctx, deal, "admin")
          : await refundToBuyer(ctx, deal, "admin");
      const result =
        action === "release"
          ? ok
            ? "✅ выплачены продавцу"
            : "🚨 ОШИБКА выплаты (детали в уведомлении)"
          : ok
            ? "↩️ возвращены покупателю"
            : "🚨 ОШИБКА возврата (детали в уведомлении)";
      await editSource(ctx, cb, `⚖️ Сделка #${dealId}: средства ${result}.`);
      await answer();
      return;
    }

    if (data.startsWith("adm:cancel:")) {
      const dealId = data.split(":")[2];
      const deal = await ctx.db.getDeal(dealId);
      if (!deal || (deal.status !== d.WAITING_PARTY && deal.status !== d.WAITING_PAYMENT)) {
        await answer("Эту сделку нельзя отменить (уже оплачена или закрыта).", true);
        return;
      }
      await ctx.db.setStatus(dealId, d.CANCELLED);
      await editSource(ctx, cb, `❌ Сделка #${dealId} отменена администратором.`);
      const others = new Set([deal.seller_id, deal.buyer_id, deal.creator_id]);
      others.delete(null);
      for (const uid of others) {
        await notify(ctx, uid, `❌ Сделка #${dealId} отменена администратором.`);
      }
      await answer();
      return;
    }

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
