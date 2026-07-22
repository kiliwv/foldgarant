import type { Config, Env } from "./config";
import { loadConfig } from "./config";
import { CryptoPay } from "./cryptopay";
import { Db } from "./db";
import { Telegram } from "./telegram";

/** Общий контекст запроса: клиенты API, база и конфигурация. */
export interface Ctx {
  tg: Telegram;
  db: Db;
  cp: CryptoPay;
  cfg: Config;
  ai?: Ai;
}

export function makeCtx(env: Env): Ctx {
  const cfg = loadConfig(env);
  return {
    tg: new Telegram(env.BOT_TOKEN),
    db: new Db(env.DB),
    cp: new CryptoPay(env.CRYPTOPAY_TOKEN, cfg.cryptopayTestnet),
    cfg,
    ai: env.AI,
  };
}
