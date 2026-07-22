// Минимальный клиент Telegram Bot API поверх fetch.

import type { InlineKeyboardMarkup, TgUser } from "./types";

export class TelegramError extends Error {
  constructor(
    public code: number,
    public description: string,
  ) {
    super(`Telegram error ${code}: ${description}`);
  }
}

export class Telegram {
  private me: TgUser | null = null;

  constructor(private token: string) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) body[k] = v;
    }
    const resp = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
    if (!data.ok) throw new TelegramError(data.error_code ?? 0, data.description ?? "UNKNOWN");
    return data.result as T;
  }

  sendMessage(
    chatId: number,
    text: string,
    extra: { reply_markup?: InlineKeyboardMarkup } = {},
  ) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...extra,
    });
  }

  editMessageText(params: {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    text: string;
    reply_markup?: InlineKeyboardMarkup;
  }) {
    return this.call("editMessageText", { parse_mode: "HTML", ...params });
  }

  answerCallbackQuery(id: string, text?: string, showAlert = false) {
    return this.call("answerCallbackQuery", {
      callback_query_id: id,
      text,
      show_alert: showAlert || undefined,
    });
  }

  answerInlineQuery(
    id: string,
    results: unknown[],
    extra: { cache_time?: number; is_personal?: boolean } = {},
  ) {
    return this.call("answerInlineQuery", { inline_query_id: id, results, ...extra });
  }

  async getMe(): Promise<TgUser> {
    if (!this.me) this.me = await this.call<TgUser>("getMe");
    return this.me;
  }

  setWebhook(url: string, secretToken: string) {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query", "inline_query", "chosen_inline_result"],
    });
  }

  setMyCommands(commands: { command: string; description: string }[]) {
    return this.call("setMyCommands", { commands });
  }
}
