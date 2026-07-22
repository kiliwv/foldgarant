// Минимальные типы Telegram Bot API (только используемые поля).

export interface TgUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  custom_emoji_id?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  entities?: TgMessageEntity[];
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  inline_message_id?: string;
  data?: string;
}

export interface TgInlineQuery {
  id: string;
  from: TgUser;
  query: string;
}

export interface TgChosenInlineResult {
  result_id: string;
  from: TgUser;
  inline_message_id?: string;
  query: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  inline_query?: TgInlineQuery;
  chosen_inline_result?: TgChosenInlineResult;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  // Цветные кнопки (Bot API 9.4+): "success" — зелёная, "danger" — красная,
  // "primary" — синяя. Старые клиенты показывают обычную кнопку.
  style?: string;
  // Иконка из эмодзи-пака перед текстом кнопки (Bot API 9.4+).
  // Работает, если у бота есть Fragment-юзернейм или у владельца бота
  // активна подписка Telegram Premium.
  icon_custom_emoji_id?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export function fullName(user: TgUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}
