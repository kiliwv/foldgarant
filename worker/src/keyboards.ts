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

export function mainMenu(): InlineKeyboardMarkup {
  return kb([
    [
      { text: `👤${MONO} Профиль`, callback_data: "menu:profile" },
      { text: "🔍 Поиск", callback_data: "menu:search" },
    ],
    [{ text: `🛡${MONO} Новая сделка`, callback_data: "menu:newdeal", style: SUCCESS }],
    [
      { text: `🗂${MONO} Мои сделки`, callback_data: "menu:mydeals" },
      { text: "ℹ️ Как это работает", callback_data: "menu:help" },
    ],
  ]);
}

/** Кнопка возврата в главное меню. */
export function backKb(): InlineKeyboardMarkup {
  return kb([[{ text: `↩${MONO} Назад`, callback_data: "menu:back" }]]);
}

export function roleKb(): InlineKeyboardMarkup {
  return kb([
    [{ text: "🛒 Покупатель", callback_data: "role:buyer", style: SUCCESS }],
    [{ text: "💼 Продавец", callback_data: "role:seller", style: DANGER }],
    [{ text: `↩${MONO} Назад`, callback_data: "menu:back" }],
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
    [{ text: "🤝 Присоединиться к сделке", callback_data: `deal:join:${dealId}`, style: SUCCESS }],
  ]);
}

/** Заглушка для inline-сообщения, пока сделка создаётся. */
export function processingKb(): InlineKeyboardMarkup {
  return kb([[{ text: "⏳ Создание сделки...", callback_data: "noop" }]]);
}

export function payKb(payUrl: string, dealId: string): InlineKeyboardMarkup {
  return kb([
    [{ text: "💳 Оплатить через CryptoBot", url: payUrl, style: SUCCESS }],
    [{ text: "✖️ Отменить сделку", callback_data: `deal:cancel:${dealId}`, style: DANGER }],
  ]);
}

export function cancelDealKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [{ text: "✖️ Отменить сделку", callback_data: `deal:cancel:${dealId}`, style: DANGER }],
  ]);
}

/** Кнопки покупателя, когда деньги в холде. */
export function buyerEscrowKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [{ text: "✅ Я получил товар/услугу", callback_data: `deal:release:${dealId}`, style: SUCCESS }],
    [{ text: "⚠️ Открыть спор", callback_data: `deal:dispute:${dealId}`, style: DANGER }],
  ]);
}

/** Кнопки продавца, когда деньги в холде. */
export function sellerEscrowKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [
      {
        text: "↩️ Вернуть деньги покупателю",
        callback_data: `deal:refund:${dealId}`,
        style: PRIMARY,
      },
    ],
    [{ text: "⚠️ Открыть спор", callback_data: `deal:dispute:${dealId}`, style: DANGER }],
  ]);
}

export function confirmReleaseKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [{ text: "✅ Да, подтверждаю", callback_data: `deal:release2:${dealId}`, style: SUCCESS }],
    [{ text: `↩${MONO} Назад`, callback_data: `deal:back:${dealId}` }],
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
  return kb([[{ text: "⏭ Пропустить", callback_data: "rate:skip_comment" }]]);
}

export function disputeResolveKb(dealId: string): InlineKeyboardMarkup {
  return kb([
    [{ text: "💸 Выплатить продавцу", callback_data: `resolve:release:${dealId}`, style: SUCCESS }],
    [{ text: "↩️ Вернуть покупателю", callback_data: `resolve:refund:${dealId}`, style: DANGER }],
  ]);
}
