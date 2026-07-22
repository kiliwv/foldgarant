// Точка входа Cloudflare Worker (замена main.py).
//
// Вместо long polling бот работает на вебхуках:
//   POST /tg/webhook        — обновления от Telegram (защита секретным токеном)
//   POST /cryptopay/webhook — уведомления об оплате от Crypto Pay (проверка подписи)
//   GET  /setup?secret=...  — одноразовая настройка: регистрирует вебхук и команды
// Cron (раз в минуту) — фолбэк-проверка оплат вместо bot/watcher.py.

import type { Env } from "./config";
import { makeCtx } from "./ctx";
import { checkCryptoPaySignature } from "./cryptopay";
import { handleUpdate } from "./handlers/update";
import { checkPendingPayments, markDealPaid } from "./services";
import type { TgUpdate } from "./types";

const COMMANDS = [
  { command: "start", description: "Главное меню" },
  { command: "newdeal", description: "Создать сделку" },
  { command: "mydeals", description: "Мои активные сделки" },
  { command: "profile", description: "Мой профиль и репутация" },
  { command: "whois", description: "Профиль пользователя по ID" },
  { command: "help", description: "Как это работает" },
];

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = (await request.json()) as TgUpdate;
  const ctx = makeCtx(env);
  try {
    await handleUpdate(ctx, update);
  } catch (e) {
    // Отвечаем 200, чтобы Telegram не ретраил то же обновление бесконечно.
    console.error("Ошибка обработки обновления", e);
  }
  return new Response("ok");
}

async function handleCryptoPayWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("crypto-pay-api-signature");
  if (!(await checkCryptoPaySignature(env.CRYPTOPAY_TOKEN, body, signature))) {
    return new Response("forbidden", { status: 403 });
  }

  const update = JSON.parse(body) as {
    update_type?: string;
    payload?: { invoice_id?: number; status?: string; payload?: string };
  };
  if (update.update_type === "invoice_paid" && update.payload?.status === "paid") {
    const ctx = makeCtx(env);
    const dealId = update.payload.payload; // в payload счёта записан ID сделки
    try {
      if (dealId) {
        const deal = await ctx.db.getDeal(dealId);
        if (deal && deal.invoice_id === update.payload.invoice_id) {
          await markDealPaid(ctx, dealId);
        }
      }
    } catch (e) {
      console.error("Ошибка обработки вебхука Crypto Pay", e);
    }
  }
  return new Response("ok");
}

/** Одноразовая настройка после деплоя: вебхук Telegram + список команд. */
async function handleSetup(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!env.WEBHOOK_SECRET || url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const ctx = makeCtx(env);
  await ctx.db.ensureBalancesTable(); // миграция для баз без таблицы балансов
  const webhookUrl = `${url.origin}/tg/webhook`;
  await ctx.tg.setWebhook(webhookUrl, env.WEBHOOK_SECRET);
  await ctx.tg.setMyCommands(COMMANDS);
  const me = await ctx.tg.getMe();
  const cpApp = await ctx.cp.getMe();

  return Response.json({
    ok: true,
    bot: `@${me.username}`,
    crypto_pay_app: cpApp.name ?? null,
    telegram_webhook: webhookUrl,
    cryptopay_webhook: `${url.origin}/cryptopay/webhook`,
    hint:
      "Укажите cryptopay_webhook в настройках приложения Crypto Pay " +
      "(@CryptoBot → Crypto Pay → My Apps → Webhooks). " +
      "Без него оплата тоже засчитается — cron проверяет счета раз в минуту.",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/tg/webhook") {
      return handleTelegramWebhook(request, env);
    }
    if (request.method === "POST" && url.pathname === "/cryptopay/webhook") {
      return handleCryptoPayWebhook(request, env);
    }
    if (request.method === "GET" && url.pathname === "/setup") {
      return handleSetup(request, env);
    }
    return new Response("Foldgarant bot is running", { status: 200 });
  },

  // Фолбэк-проверка оплат (замена bot/watcher.py): раз в минуту по cron.
  async scheduled(_event: ScheduledController, env: Env, ectx: ExecutionContext): Promise<void> {
    const ctx = makeCtx(env);
    ectx.waitUntil(
      checkPendingPayments(ctx).catch((e) => console.error("Ошибка при проверке оплат", e)),
    );
  },
} satisfies ExportedHandler<Env>;
