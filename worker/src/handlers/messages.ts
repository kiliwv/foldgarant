// Обработка входящих сообщений: команды и шаги FSM
// (порт bot/handlers/start.py, profile.py, admin.py и message-хендлеров deals.py, ratings.py).

import type { Ctx } from "../ctx";
import * as d from "../db";
import {
  adminPanelKb,
  backKb,
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
export const ST_SEARCH = "search:query";

export const WELCOME =
  "🛡 <b>Гарант-сервис — безопасные сделки</b>\n\n" +
  "Деньги покупателя хранятся у гаранта (через @CryptoBot) " +
  "и передаются продавцу только после подтверждения получения " +
  "товара или услуги.\n\n" +
  "Проверяйте репутацию пользователей перед сделкой и оставляйте " +
  "отзывы после.\n\n" +
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
  "<code>@имя_бота 25 дизайн логотипа</code>\n" +
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
    `👤 <b>Профиль ${escapeHtml(name)}</b> [ ID: <code>${userId}</code> ]`,
    "",
    `⭐️ Репутация: ${reputationLine(stats.positive, stats.negative)}`,
    `🤝 Сделки: <b>${stats.completed}</b> шт · оборот: ${volume}`,
    "",
    `<b>В сервисе с ${regDate}</b>`,
  ];

  if (reviews.length) {
    lines.push("", "💬 <b>Последние отзывы:</b>");
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
  await ctx.tg.sendMessage(
    chatId,
    "🛡 <b>Создание сделки</b>\n\n" +
      "Кем вы выступаете?\n\n" +
      "🛒 <b>Покупатель</b> — вы платите и ждёте товар или услугу\n" +
      "💼 <b>Продавец</b> — вы передаёте товар или услугу и ждёте оплату",
    { reply_markup: roleKb() },
  );
}

/** Ищет профиль по «@юзернейм» / «юзернейм» / числовому ID. */
export async function findProfile(ctx: Ctx, query: string): Promise<string> {
  const q = query.trim();
  if (/^\d+$/.test(q)) {
    return profileText(ctx, parseInt(q, 10));
  }
  const username = q.replace(/^@/, "");
  if (!username) return "❌ Отправьте @юзернейм или ID пользователя.";
  const user = await ctx.db.getUserByUsername(username);
  if (!user) {
    return (
      "❌ Пользователь не найден. Он должен хотя бы раз запустить этого бота, " +
      "чтобы появиться в системе."
    );
  }
  return profileText(ctx, user.id);
}

async function cmdWhois(ctx: Ctx, msg: TgMessage): Promise<void> {
  const parts = (msg.text ?? "").split(/\s+/).filter(Boolean);
  const arg = parts[1]?.trim();
  if (!arg) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "Использование: <code>/whois @юзернейм</code> или <code>/whois ID</code>",
    );
    return;
  }
  await ctx.tg.sendMessage(msg.chat.id, await findProfile(ctx, arg), {
    reply_markup: backKb(),
  });
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

export async function balanceText(ctx: Ctx): Promise<string> {
  const balances = await ctx.cp.getBalance();
  const lines = ["💰 <b>Баланс приложения Crypto Pay:</b>"];
  for (const b of balances) {
    const available = parseFloat(b.available ?? "0");
    if (available > 0 || ctx.cfg.assets.includes(b.currency_code)) {
      lines.push(`├ ${b.currency_code}: ${fmtAmount(available)}`);
    }
  }
  return lines.join("\n");
}

async function cmdBalance(ctx: Ctx, msg: TgMessage): Promise<void> {
  await ctx.tg.sendMessage(msg.chat.id, await balanceText(ctx));
}

export async function adminPanel(
  ctx: Ctx,
): Promise<{ text: string; kb: ReturnType<typeof adminPanelKb> }> {
  const counts = await ctx.db.countsByStatus();
  const n = (s: string) => counts[s] ?? 0;
  const text =
    "🛠 <b>Админ-панель</b>\n\n" +
    "Проблемные сделки:\n" +
    `⚠️ Споры: <b>${n(d.DISPUTED)}</b>\n` +
    `🔒 В холде (деньги у гаранта): <b>${n(d.PAID)}</b>\n\n` +
    "Активные:\n" +
    `💳 Ждут оплату: ${n(d.WAITING_PAYMENT)}\n` +
    `⏳ Ждут второго участника: ${n(d.WAITING_PARTY)}\n\n` +
    "Закрытые:\n" +
    `✅ Завершено: ${n(d.COMPLETED)} · ↩️ Возвраты: ${n(d.REFUNDED)} · ` +
    `❌ Отменено: ${n(d.CANCELLED)}`;
  const kb = adminPanelKb({
    disputed: n(d.DISPUTED),
    paid: n(d.PAID),
    waitingPayment: n(d.WAITING_PAYMENT),
    waitingParty: n(d.WAITING_PARTY),
  });
  return { text, kb };
}

/** Тест вариантов разметки цитат — чтобы подобрать вид без цветной полоски. */
async function cmdTestQuote(ctx: Ctx, msg: TgMessage): Promise<void> {
  await ctx.tg.sendMessage(
    msg.chat.id,
    "<blockquote>💸 <b>Вариант 1</b>\n\nВсё сообщение — одна цитата, " +
      "с первого символа до последнего.\nСтрока для объёма.</blockquote>",
  );
  await ctx.tg.sendMessage(
    msg.chat.id,
    "💸 <b>Вариант 2</b>\n<blockquote>Цитата — только часть сообщения " +
      "(так сделано сейчас).</blockquote>",
  );
  await ctx.tg.sendMessage(
    msg.chat.id,
    "<blockquote expandable>💸 <b>Вариант 3</b>\n\nСворачиваемая цитата на всё сообщение.\n" +
      "Строка 2.\nСтрока 3.\nСтрока 4.</blockquote>",
  );
}

// ID эмодзи, присланные владельцем через /emojiid (порядок: профиль, поиск,
// щит, папка, инфо, назад, корзина, портфель).
const TEST_ICON_IDS: [string, string][] = [
  ["Профиль", "5886412370347036129"],
  ["Поиск", "5874960879434338403"],
  ["Новая сделка", "5886306834410640699"],
  ["Мои сделки", "5967389567781703494"],
  ["Как это работает", "5897846616966041652"],
  ["Назад", "5875082500023258804"],
  ["Покупатель", "5920344347152224466"],
  ["Продавец", "5983399041197675256"],
];

/** Тест кастомных эмодзи в тексте сообщения (tg-emoji). */
async function cmdTestText(ctx: Ctx, msg: TgMessage): Promise<void> {
  const fallbacks = ["👤", "🔍", "🛡", "🗂", "ℹ️", "↩️", "🛒", "💼"];
  const line = TEST_ICON_IDS.map(
    ([, id], i) => `<tg-emoji emoji-id="${id}">${fallbacks[i]}</tg-emoji>`,
  ).join(" ");
  try {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "🧪 Тест эмодзи в тексте:\n\n" +
        line +
        "\n\nЕсли выше иконки из вашего пака — значит, текстовые эмодзи " +
        "работают и их можно заменить во всех сообщениях. " +
        "Если обычные эмодзи — Telegram требует Fragment-юзернейм для текста.",
    );
  } catch (e) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "❌ Telegram отклонил кастомные эмодзи в тексте:\n<code>" + String(e) + "</code>",
    );
  }
}

/** Тест иконок из эмодзи-паков в кнопках (icon_custom_emoji_id). */
async function cmdTestIcon(ctx: Ctx, msg: TgMessage): Promise<void> {
  const rows = TEST_ICON_IDS.map(([label, id], i) => [
    { text: `${i + 1}. ${label}`, callback_data: "icontest", icon_custom_emoji_id: id },
  ]);
  try {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "🧪 Тест иконок в кнопках.\nПроверьте, что иконки видны и совпадают с подписями:",
      { reply_markup: { inline_keyboard: rows } },
    );
  } catch (e) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "❌ Telegram отклонил иконки в кнопках:\n<code>" +
        String(e) +
        "</code>\n\nСкорее всего, у владельца бота нет активного Telegram Premium " +
        "(или у бота нет Fragment-юзернейма).",
    );
  }
}

/** Показывает ID кастомных эмодзи из сообщения (для icon_custom_emoji_id). */
async function cmdEmojiId(ctx: Ctx, msg: TgMessage): Promise<void> {
  const ids = (msg.entities ?? [])
    .filter((e) => e.type === "custom_emoji" && e.custom_emoji_id)
    .map((e) => e.custom_emoji_id!);
  if (!ids.length) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "Отправьте команду вместе с эмодзи из паков в одном сообщении:\n" +
        "<code>/emojiid</code> 🙂🙂🙂 (эмодзи должны быть премиум-эмодзи из паков)",
    );
    return;
  }
  const lines = ids.map((id, i) => `${i + 1}. <code>${id}</code>`);
  await ctx.tg.sendMessage(
    msg.chat.id,
    "🆔 <b>ID кастомных эмодзи:</b>\n" + lines.join("\n"),
  );
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

async function fsmSearch(ctx: Ctx, msg: TgMessage): Promise<void> {
  const query = (msg.text ?? "").trim();
  if (!query) {
    await ctx.tg.sendMessage(
      msg.chat.id,
      "🔍 <b>Поиск</b>\n\nОтправьте @юзернейм или ID пользователя для поиска.",
      { reply_markup: backKb() },
    );
    return;
  }
  await ctx.db.clearState(msg.from!.id);
  await ctx.tg.sendMessage(msg.chat.id, await findProfile(ctx, query), {
    reply_markup: backKb(),
  });
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
      case "/admin":
        if (isAdmin(ctx, user.id)) {
          const panel = await adminPanel(ctx);
          await ctx.tg.sendMessage(msg.chat.id, panel.text, { reply_markup: panel.kb });
        }
        return;
      case "/disputes":
        if (isAdmin(ctx, user.id)) return cmdDisputes(ctx, msg);
        return;
      case "/balance":
        if (isAdmin(ctx, user.id)) return cmdBalance(ctx, msg);
        return;
      case "/emojiid":
        if (isAdmin(ctx, user.id)) return cmdEmojiId(ctx, msg);
        return;
      case "/testquote":
        if (isAdmin(ctx, user.id)) return cmdTestQuote(ctx, msg);
        return;
      case "/testicon":
        if (isAdmin(ctx, user.id)) return cmdTestIcon(ctx, msg);
        return;
      case "/testtext":
        if (isAdmin(ctx, user.id)) return cmdTestText(ctx, msg);
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
    case ST_SEARCH:
      return fsmSearch(ctx, msg);
    default:
      return;
  }
}
