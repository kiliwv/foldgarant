// Диспетчер Telegram-обновлений + проверка бана
// (замена aiogram Dispatcher и BanMiddleware).

import type { Ctx } from "../ctx";
import type { TgUpdate, TgUser } from "../types";
import { handleCallback } from "./callbacks";
import { handleInlineQuery, handleChosenInlineResult } from "./inline";
import { handleMessage } from "./messages";

/** true, если пользователь заблокирован (и ему уже отправлен отказ). */
async function isBanned(ctx: Ctx, user: TgUser, update: TgUpdate): Promise<boolean> {
  const row = await ctx.db.getUser(user.id);
  if (!row?.is_banned) return false;
  if (update.callback_query) {
    await ctx.tg
      .answerCallbackQuery(update.callback_query.id, "🚫 Вы заблокированы в сервисе.", true)
      .catch(() => {});
  } else if (update.message) {
    await ctx.tg
      .sendMessage(update.message.chat.id, "🚫 Вы заблокированы в сервисе.")
      .catch(() => {});
  }
  return true;
}

export async function handleUpdate(ctx: Ctx, update: TgUpdate): Promise<void> {
  if (update.message) {
    const user = update.message.from;
    if (user && (await isBanned(ctx, user, update))) return;
    await handleMessage(ctx, update.message);
  } else if (update.callback_query) {
    if (await isBanned(ctx, update.callback_query.from, update)) return;
    await handleCallback(ctx, update.callback_query);
  } else if (update.inline_query) {
    await handleInlineQuery(ctx, update.inline_query);
  } else if (update.chosen_inline_result) {
    await handleChosenInlineResult(ctx, update.chosen_inline_result);
  }
}
