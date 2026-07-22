// Обработка входящих сообщений: команды и шаги FSM
// (порт bot/handlers/start.py, profile.py, admin.py и message-хендлеров deals.py, ratings.py).

import type { Ctx } from "../ctx";
import * as d from "../db";
import {
  buyerEscrowKb,
  cancelDealKb,
  confirmDealKb,
  joinDealKb,
  mainMenu,
  payKb,
  roleKb,
  sellerEscrowKb,
  disputeResolveKb,
} from "../keyboards";
import { fmtAmount, dealCard, escapeHtml, reputationLine, round8 } from "../utils";
import type { TgMessage } from "../types";
import { fullName } from "../types";

export const MAX_DESCRIPTION = 500;
export const MAX_COMMENT = 300;

// Имена FSM-состояний (замена bot/states.py)
export const ST_NEWDEAL_ROLE = "newdeal:role";
export const ST_NEWDEAL_ASSET = "newdeal:asset";
export const ST_NEWDEAL_AMOUNT = "newdeal:amount";
export const ST_NEWDEAL_DESCRIPTION = "newdeal:description";
export const ST_NEWDEAL_CONFIRM = "newdeal:confirm";
export const ST_RATE_COMMENT = "rate:waiting_comment";

export const WELCOME =
  "👋 <b>Добро пожаловать в гарант-бота!</b>\n\n" +
  "Я выступаю посредником в сделках между покупателем и продавцом:\n" +
  "деньги покупателя хранятся у меня (через @CryptoBot) и передаются " +
  "продавцу только после подтверждения получения товара или услуги.\n\n" +
  "Выберите действие:";

export const HELP_TEXT =
  "ℹ️ <b>Как проходит сделка</b>\n\n" +
  "1️⃣ Один из участников создаёт сделку и получает ссылку-приглашение.\n" +
  "2️⃣ Второй участник переходит по ссылке и присоединяется.\n" +
  "3️⃣ Покупатель оплачивает счёт через @CryptoBot — деньги замораживаются у гаранта.\n" +
  "4️⃣ Продавец передаёт товар/услугу.\n" +
  "5️⃣ Покупатель подтверждает получение — деньги уходят продавцу (за вычетом комиссии сервиса).\n\n" +
  "⚠️ Если что-то пошло не так — любая из сторон может открыть спор, " +
  "его рассмотрит администратор.\n" +
  "⭐️ После каждой сделки участники оценивают друг друга — так формируется репутация.\n\n" +
  "⚡️ <b>Сделка прямо в чате</b>: в любом диалоге введите\n" +
  "<code>@имя_бота 25 USDT дизайн логотипа</code>\n" +
  "выберите роль — и собеседнику придёт приглашение с кнопкой (как @send у CryptoBot).\n\n" +
  "❗️ Для получения выплат у вас должен быть открыт @CryptoBot (нажмите там Start).";

export async function profileText(ctx: Ctx, userId: number): Promise<string> {
  const user = await ctx.db.getUser(userId);
  if (!user) return "❌ Пользователь не найден. Нажмите /start.";

  const stats = await ctx.db.userStats(userId);
  const reviews = await ctx.db.lastReviews(userId);

  const dt = new Date(user.created_at);
  const regDate = `${String(dt.getUTCDate()).padStart(2, "0")}.${String(
    dt.getUTCMonth() + 1,
  ).padStart(2, "0")}.${dt.getUTCFullYear()}`;
  const name = user.username ? `@${user.username}` : (user.full_name ?? String(userId));

  const volume = Object.keys(stats.volumes).length
    ? Object.entries(stats.volumes)
        .map(([asset, v]) => `${fmtAmount(v)} ${asset}`)
        .join(", ")
    : "0";

  const lines = [
    `👤 <b>Профиль ${escapeHtml(name)}</b>`,
    `├ ID: <code>${userId}</code>`,
    `├ В сервисе с: ${regDate}`,
    `├ Завершённых сделок: <b>${stats.completed}</b>`,
    `├ Оборот: ${volume}`,
    `└ Репутация: ${reputationLine(stats.positive, stats.negative)}`,
  ];

  if (reviews.length) {
    lines.push("\n💬 <b>Последние отзывы:</b>");
    for (const r of reviews) {
      const emoji = r.score > 0 ? "👍" : "👎";
      const author = r.from_username ? `@${r.from_username}` : "аноним";
      lines.push(`${emoji} ${escapeHtml(author)}: «${escapeHtml(r.comment ?? "")}»`);
    }
  }

  return lines.join("\n");
}

export async function sendMyDeals(ctx: Ctx, chatId: number, userId: number): Promise<void> {
  const deals = await ctx.db.userActiveDeals(userId);
  if (!deals.length) {
    await ctx.tg.sendMessage(chatId, "📂 У вас нет активных сделок.", {
      reply_markup: mainMenu(),
    });
    return;
  }
  for (const deal of deals) {
    const card = await dealCard(ctx.db, deal);
    let kb;
    if (deal.status === d.PAID) {
      kb = userId === deal.buyer_id ? buyerEscrowKb(deal.id) : sellerEscrowKb(deal.id);
    } else if (deal.status === d.WAITING_PAYMENT && userId === deal.buyer_id && deal.pay_url) {
      kb = payKb(deal.pay_url, deal.id);
    } else if (deal.status === d.WAITING_PARTY || deal.status === d.WAITING_PAYMENT) {
      kb = cancelDealKb(deal.id);
    }
    await ctx.tg.sendMessage(chatId, card, { reply_markup: kb });
  }
}

function isAdmin(ctx: Ctx, userId: number): boolean {
  return ctx.cfg.adminIds.includes(userId);
}

// --- Команды -----------------------------------------------------------------

async function cmdStart(ctx: Ctx, msg: TgMessage, args: string): Promise<void> {
  const user = msg.from!;
  await ctx.db.upsertUser(user.id, user.username ?? null, fullName(user));
  await ctx.db.clearState(user.id);

  if (args.startsWith("deal_")) {
    const dealId = args.slice("deal_".length);
    const deal = await ctx.db.getDeal(dealId);
    if (!deal) {
      await ctx.tg.sendMessage(msg.chat.id, "❌ Сделка не найдена.", { reply_markup: mainMenu() });
      return;
    }
    if (deal.status !== d.WAITING_PARTY) {
      await ctx.tg.sendMessage(msg.chat.id, "❌ К этой сделке уже нельзя присоединиться.", {
        reply_markup: mainMenu(),
      });
      return;
    }
    if (user.id === deal.creator_id) {
      await ctx.tg.sendMessage(
        msg.chat.id,
        "🙃 Это ваша собственная сделка — отправьте ссылку второму участнику.",
      );
      return;
    }
    const card = await dealCard(ctx.db, deal);
    const role = deal.seller_id === null ? "продавца" : "покупателя";
    await ctx.tg.sendMessage(
      msg.chat.id,
      `${card}\n\nВам предлагают присоединиться в роли <b>${role}</b>.`,
      { reply_markup: joinDealKb(dealId) },
    );
    return;
  }

  await ctx.tg.sendMessage(msg.chat.id, WELCOME, { reply_markup: mainMenu() });
}

export async function startNewDeal(ctx: Ctx, chatId: number, userId: number): Promise<void> {
  await ctx.db.setState(userId, ST_NEWDEAL_ROLE, {});
  await ctx.tg.sendMessage(chatId, "🤝 <b>Новая сделка</b>\n\nКто вы в этой сделке?", {
    reply_markup: roleKb(),
  });
}

async function cmdWhois(ctx: Ctx, msg: TgMessage): Promise<void> {
  const parts = (msg.text ?? "").split(/\s+/).filter(Boolean);
  const arg = parts[1]?.trim();
  if (!arg || !/^\d+$/.test(arg)) {
    await ctx.tg.sendMessage(msg.chat.id, "Использование: <code>/whois ID_пользователя</code>");
    return;
  }
  await ctx.tg.sendMessage(msg.chat.id, await profileText(ctx, parseInt(arg, 10)));
}

async function cmdDisputes(ctx: Ctx, msg: TgMessage): Promise<void> {
  const deals = await ctx.db.disputedDeals();
  if (!deals.length) {
    await ctx.tg.sendMessage(msg.chat.id, "✅ Открытых споров нет.");
    return;
  }
  for (const deal of deals) {
    const card = await dealCard(ctx.db, deal);
    await ctx.tg.sendMessage(msg.chat.id, card, { reply_markup: disputeResolveKb(deal.id) });
  }
}

async function cmdBalance(ctx: Ctx, msg: TgMessage): Promise<void> {
  const balances = await ctx.cp.getBalance();
  const lines = ["💰 <b>Баланс приложения Crypto Pay:</b>"];
  for (const b of balances) {
    const available = parseFloat(b.available ?? "0");
    if (available > 0 || ctx.cfg.assets.includes(b.currency_code)) {
      lines.push(`├ ${b.currency_code}: ${fmtAmount(available)}`);
    }
  }
  await ctx.tg.sendMessage(msg.chat.id, lines.join("\n"));
}

async function cmdBanUnban(ctx: Ctx, msg: TgMessage, ban: boolean): Promise<void> {
  const parts = (msg.text ?? "").split(/\s+/).filter(Boolean);
  const cmd = ban ? "/ban" : "/unban";
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
    await ctx.tg.sendMessage(msg.chat.id, `Использование: <code>${cmd} ID_пользователя</code>`);
    return;
  }
  await ctx.db.setBanned(parseInt(parts[1], 10), ban);
  await ctx.tg.sendMessage(
    msg.chat.id,
    ban ? `🚫 Пользователь ${parts[1]} заблокирован.` : `✅ Пользователь ${parts[1]} разблокирован.`,
  );
}

// --- Шаги FSM ----------------------------------------------------------------

async function fsmAmount(ctx: Ctx, msg: TgMessage, data: Record<string, unknown>): Promise<void> {
  const raw = (msg.text ?? "").replace(",", ".").trim();
  const amount = raw ? Number(raw) : NaN;
  if (Number.isNaN(amount)) {
    await ctx.tg.sendMessage(msg.chat.id, "❌ Введите число, например: <code>10.5</code>");
    return;
  }
  if (amount < ctx.cfg.minAmount) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      `❌ Минимальная сумма — ${fmtAmount(ctx.cfg.minAmount)}. Введите сумму ещё раз:`,
    );
    return;
  }
  await ctx.db.setState(msg.from!.id, ST_NEWDEAL_DESCRIPTION, { ...data, amount: round8(amount) });
  await ctx.tg.sendMessage(
    msg.chat.id,
    "📝 Опишите предмет сделки (что передаётся, сроки, условия). " +
      `До ${MAX_DESCRIPTION} символов:`,
  );
}

async function fsmDescription(
  ctx: Ctx,
  msg: TgMessage,
  data: Record<string, unknown>,
): Promise<void> {
  const description = (msg.text ?? "").trim();
  if (!description) {
    await ctx.tg.sendMessage(msg.chat.id, "❌ Отправьте текстовое описание сделки:");
    return;
  }
  if (description.length > MAX_DESCRIPTION) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      `❌ Слишком длинно (максимум ${MAX_DESCRIPTION} символов). Сократите:`,
    );
    return;
  }
  const newData: Record<string, unknown> = { ...data, description };
  await ctx.db.setState(msg.from!.id, ST_NEWDEAL_CONFIRM, newData);

  const roleLabel = newData.role === "seller" ? "продавец" : "покупатель";
  const amount = newData.amount as number;
  const asset = newData.asset as string;
  const payout = amount * (1 - ctx.cfg.commissionPercent / 100);
  await ctx.tg.sendMessage(
    msg.chat.id,
    "🔎 <b>Проверьте условия сделки:</b>\n\n" +
      `├ Ваша роль: <b>${roleLabel}</b>\n` +
      `├ Сумма: <b>${fmtAmount(amount)} ${asset}</b>\n` +
      `├ Комиссия сервиса: ${ctx.cfg.commissionPercent}% ` +
      `(продавец получит ${fmtAmount(round8(payout))} ${asset})\n` +
      `└ Описание: ${escapeHtml(description)}`,
    { reply_markup: confirmDealKb() },
  );
}

async function fsmRateComment(
  ctx: Ctx,
  msg: TgMessage,
  data: Record<string, unknown>,
): Promise<void> {
  const comment = (msg.text ?? "").trim();
  if (!comment) {
    await ctx.tg.sendMessage(msg.chat.id, "❌ Отправьте текст отзыва или нажмите «Пропустить».");
    return;
  }
  if (comment.length > MAX_COMMENT) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      `❌ Слишком длинно (максимум ${MAX_COMMENT} символов). Сократите:`,
    );
    return;
  }
  await ctx.db.setRatingComment(data.rate_deal_id as string, msg.from!.id, comment);
  await ctx.db.clearState(msg.from!.id);
  await ctx.tg.sendMessage(
    msg.chat.id,
    "✅ Спасибо! Отзыв сохранён и будет виден в профиле контрагента.",
  );
}

// --- Диспетчер ---------------------------------------------------------------

export async function handleMessage(ctx: Ctx, msg: TgMessage): Promise<void> {
  const user = msg.from;
  if (!user || msg.chat.type !== "private") return;
  const text = msg.text ?? "";

  if (text.startsWith("/")) {
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split("@")[0].toLowerCase();
    switch (cmd) {
      case "/start":
        return cmdStart(ctx, msg, rest.join(" "));
      case "/help":
        await ctx.tg.sendMessage(msg.chat.id, HELP_TEXT, { reply_markup: mainMenu() });
        return;
      case "/newdeal":
        await ctx.db.upsertUser(user.id, user.username ?? null, fullName(user));
        return startNewDeal(ctx, msg.chat.id, user.id);
      case "/mydeals":
        return sendMyDeals(ctx, msg.chat.id, user.id);
      case "/profile":
        await ctx.tg.sendMessage(msg.chat.id, await profileText(ctx, user.id));
        return;
      case "/whois":
        return cmdWhois(ctx, msg);
      case "/disputes":
        if (isAdmin(ctx, user.id)) return cmdDisputes(ctx, msg);
        return;
      case "/balance":
        if (isAdmin(ctx, user.id)) return cmdBalance(ctx, msg);
        return;
      case "/ban":
        if (isAdmin(ctx, user.id)) return cmdBanUnban(ctx, msg, true);
        return;
      case "/unban":
        if (isAdmin(ctx, user.id)) return cmdBanUnban(ctx, msg, false);
        return;
      default:
        return;
    }
  }

  const { state, data } = await ctx.db.getState(user.id);
  switch (state) {
    case ST_NEWDEAL_AMOUNT:
      return fsmAmount(ctx, msg, data);
    case ST_NEWDEAL_DESCRIPTION:
      return fsmDescription(ctx, msg, data);
    case ST_RATE_COMMENT:
      return fsmRateComment(ctx, msg, data);
    default:
      return;
  }
}
