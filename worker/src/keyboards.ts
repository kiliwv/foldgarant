// Inline-клавиатуры, порт bot/keyboards.py.

import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./types";

// Настоящие цветные кнопки (Bot API 9.4+, поле style):
//   "success" — зелёная, "danger" — красная, "primary" — синяя.
// Старые клиенты Telegram просто показывают обычную кнопку.
const SUCCESS = "success";
const DANGER = "danger";
const PRIMARY = "primary";

const ASSET_EMOJI: Record<string, string> = { USDT: "🟢", TON: "💎", BTC: "🟠" };

function kb(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

// U+FE0E — variation selector-15: рисует эмодзи монохромным глифом
// в цвет текста кнопки (белый контур, как у ботов-референсов).
const MONO = "︎";

// ID кастомных эмодзи для иконок кнопок (Bot API 9.4, icon_custom_emoji_id).
// Узнать ID: отправьте боту /emojiid с нужными эмодзи (команда для админа).
// Работает при Fragment-юзернейме бота или Telegram Premium у владельца.
// Пустая строка — вместо иконки используется обычный эмодзи из текста.
const ICONS: Record<string, string> = {
  profile: "5886412370347036129",
  search: "5874960879434338403",
  newdeal: "5886306834410640699",
  mydeals: "5967389567781703494",
  help: "5897846616966041652",
  back: "5875082500023258804",
  buyer: "5920344347152224466",
  seller: "5983399041197675256",
  join: "5994750571041525522",
  check: "5825794181183836432",
  warn: "6028226658543082010",
  cancel: "5778527486270770928",
  pay: "5927169041595634481",
  processing: "5900104897885376843",
  money: "5974217466270716579",
  skip: "6005775159384870794",
  lock: "5879895758202735862",
};

// Иконка статуса сделки для кнопок списков
const STATUS_ICON: Record<string, string> = {
  waiting_party: "processing",
  waiting_payment: "pay",
  paid: "lock",
  completed: "check",
  refunded: "back",
  disputed: "warn",
  cancelled: "cancel",
};

/** Кнопка сделки в списке: иконка по статусу + подпись. */
export function dealListBtn(
  status: string,
  emoji: string,
  label: string,
  callbackData: string,
): InlineKeyboardButton {
  return btn(STATUS_ICON[status] ?? "mydeals", emoji, label, { callback_data: callbackData });
}

/** Кнопка-переключатель списков сделок (активные/история). */
export function listToggleBtn(label: string, callbackData: string): InlineKeyboardButton {
  return btn("mydeals", "🗂", label, { callback_data: callbackData });
}

function btn(
  icon: string,
  emoji: string,
  label: string,
  rest: Partial<InlineKeyboardButton>,
): InlineKeyboardButton {
  const id = ICONS[icon];
  if (id) return { text: label, icon_custom_emoji_id: id, ...rest } as InlineKeyboardButton;
  return { text: `${emoji} ${label}`, ...rest } as InlineKeyboardButton;
}

export function mainMenu(): InlineKeyboardMarkup {
  return kb([
    [
      btn("profile", `👤${MONO}`, "Профиль", { callback_data: "menu:profile" }),
      btn("search", "🔍", "Поиск", { callback_data: "menu:search" }),
    ],
    [btn("newdeal", `🛡${MONO}`, "Новая сделка", { callback_data: "menu:newdeal", style: SUCCESS })],
    [
      btn("mydeals", `🗂${MONO}`, "Мои сделки", { callback_data: "menu:mydeals" }),
      btn("money", "💼", "Кошелёк", { callback_data: "menu:wallet" }),
    ],
    [btn("help", "ℹ️", "Как это работает", { callback_data: "menu:help" })],
  ]);
}

/** Ряд с кнопкой возврата (для добавления к другим клавиатурам). */
export function backButtonRow(target: string, label = "Назад"): InlineKeyboardButton[] {
  return [btn("back", `↩${MONO}`, label, { callback_data: target })];
}

export function walletKb(hasFunds: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (hasFunds) {
    rows.push([
      btn("money", "💸", "Вывести", { callback_data: "wallet:withdraw", style: SUCCESS }),
    ]);
  }
  rows.push([btn("back", `↩${MONO}`, "Назад", { callback_data: "menu:back" })]);
  return kb(rows);
}

/** Кнопка возврата в главное меню. */
export function backKb(): InlineKeyboardMarkup {
  return kb([[btn("back", `↩${MONO}`, "Назад", { callback_data: "menu:back" })]]);
}

export function roleKb(): InlineKeyboardMarkup {
  return kb([
    [btn("buyer", "🛒", "Покупатель", { callback_data: "role:buyer", style: SUCCESS })],
    [btn("seller", "💼", "Продавец", { callback_data: "role:seller", style: DANGER })],
    [btn("back", `↩${MONO}`, "Назад", { callback_data: "menu:back" })],
  ]);
}

export function assetKb(assets: string[]): InlineKeyboardMarkup {
  return kb([
    assets.map((asset) => ({
      text: `${ASSET_EMOJI[asset] ?? "💠"} ${asset}`,
      callback_data: `asset:${asset}`,
      style: PRIMARY,
    })),
    [{ text: "✖️ Отмена", callback_data: "newdeal:cancel", style: DANGER }],
  ]);
}

export function confirmDealKb(): InlineKeyboardMarkup {
  return kb([
    [{ text: "✅ Создать сделку", callback_data: "newdeal:confirm", style: SUCCESS }],
    [{ text: "✖️ Отмена", callback_data: "newdeal:cancel", style: DANGER }],
  ]);
}

export function joinDealKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      btn("join", "🤝", "Присоединиться к сделке", {
        callback_data: `deal:join:${dealId}`,
        style: SUCCESS,
      }),
    ],
  ]);
}

/** Заглушка для inline-сообщения, пока сделка создаётся. */
export function processingKb(): InlineKeyboardMarkup {
  return kb([[btn("processing", "⏳", "Создание сделки...", { callback_data: "noop" })]]);
}

export function payKb(payUrl: string, dealId: string): InlineKeyboardMarkup {
  return kb([
    [btn("pay", "💳", "Оплатить через CryptoBot", { url: payUrl, style: SUCCESS })],
    [btn("cancel", "✖️", "Отменить сделку", { callback_data: `deal:cancel:${dealId}`, style: DANGER })],
  ]);
}

export function cancelDealKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [btn("cancel", "✖️", "Отменить сделку", { callback_data: `deal:cancel:${dealId}`, style: DANGER })],
  ]);
}

/** Кнопки покупателя, когда деньги в холде. */
export function buyerEscrowKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      btn("check", "✅", "Я получил товар/услугу", {
        callback_data: `deal:release:${dealId}`,
        style: SUCCESS,
      }),
    ],
    [btn("warn", "⚠️", "Открыть спор", { callback_data: `deal:dispute:${dealId}`, style: DANGER })],
  ]);
}

/** Кнопки продавца, когда деньги в холде. */
export function sellerEscrowKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      btn("back", "↩️", "Вернуть деньги покупателю", {
        callback_data: `deal:refund:${dealId}`,
        style: PRIMARY,
      }),
    ],
    [btn("warn", "⚠️", "Открыть спор", { callback_data: `deal:dispute:${dealId}`, style: DANGER })],
  ]);
}

export function confirmReleaseKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      btn("check", "✅", "Да, подтверждаю", {
        callback_data: `deal:release2:${dealId}`,
        style: SUCCESS,
      }),
    ],
    [btn("back", `↩${MONO}`, "Назад", { callback_data: `deal:back:${dealId}` })],
  ]);
}

export function rateKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      { text: "👍", callback_data: `rate:${dealId}:1`, style: SUCCESS },
      { text: "👎", callback_data: `rate:${dealId}:-1`, style: DANGER },
    ],
  ]);
}

export function skipCommentKb(): InlineKeyboardMarkup {
  return kb([[btn("skip", "⏭", "Пропустить", { callback_data: "rate:skip_comment" })]]);
}

export function adminPanelKb(counts: {
  disputed: number;
  paid: number;
  waitingPayment: number;
  waitingParty: number;
}): InlineKeyboardMarkup {
  return kb([
    [
      btn("warn", "⚠️", `Споры (${counts.disputed})`, {
        callback_data: "adm:list:disputed",
        style: counts.disputed > 0 ? DANGER : undefined,
      }),
      btn("pay", "🔒", `В холде (${counts.paid})`, { callback_data: "adm:list:paid" }),
    ],
    [
      btn("processing", "💳", `Ждут оплату (${counts.waitingPayment})`, {
        callback_data: "adm:list:waiting_payment",
      }),
      btn("mydeals", "⏳", `Ждут участника (${counts.waitingParty})`, {
        callback_data: "adm:list:waiting_party",
      }),
    ],
    [
      btn("money", "💰", "Баланс", { callback_data: "adm:balance" }),
      { text: "🔄 Обновить", callback_data: "adm:panel" },
    ],
  ]);
}

/** Действия администратора по конкретной сделке (в списках /admin). */
export function adminDealKb(dealId: string, status: string): InlineKeyboardMarkup {
  if (status === "paid" || status === "disputed") {
    return kb([
      [
        btn("money", "💸", "Выплатить продавцу", {
          callback_data: `adm:release:${dealId}`,
          style: SUCCESS,
        }),
      ],
      [
        btn("back", "↩️", "Вернуть покупателю", {
          callback_data: `adm:refund:${dealId}`,
          style: DANGER,
        }),
      ],
    ]);
  }
  return kb([
    [btn("cancel", "✖️", "Отменить сделку", { callback_data: `adm:cancel:${dealId}`, style: DANGER })],
  ]);
}

export function disputeResolveKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      btn("money", "💸", "Выплатить продавцу", {
        callback_data: `resolve:release:${dealId}`,
        style: SUCCESS,
      }),
    ],
    [
      btn("back", "↩️", "Вернуть покупателю", {
        callback_data: `resolve:refund:${dealId}`,
        style: DANGER,
      }),
    ],
  ]);
}
