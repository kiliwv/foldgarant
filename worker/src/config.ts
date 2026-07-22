export interface Env {
  DB: D1Database;
  AI?: Ai;
  // Секреты (wrangler secret put ...)
  BOT_TOKEN: string;
  CRYPTOPAY_TOKEN: string;
  WEBHOOK_SECRET: string;
  // Переменные (vars в wrangler.jsonc)
  CRYPTOPAY_TESTNET?: string;
  ADMIN_IDS?: string;
  COMMISSION_PERCENT?: string;
  MIN_AMOUNT?: string;
  ASSETS?: string;
}

export interface Config {
  cryptopayTestnet: boolean;
  adminIds: number[];
  commissionPercent: number;
  minAmount: number;
  assets: string[];
}

export function loadConfig(env: Env): Config {
  if (!env.BOT_TOKEN) throw new Error("Секрет BOT_TOKEN не задан (wrangler secret put BOT_TOKEN)");
  if (!env.CRYPTOPAY_TOKEN) throw new Error("Секрет CRYPTOPAY_TOKEN не задан (wrangler secret put CRYPTOPAY_TOKEN)");

  const adminIds = (env.ADMIN_IDS ?? "")
    .replace(/\s/g, "")
    .split(",")
    .filter(Boolean)
    .map((x) => parseInt(x, 10))
    .filter((x) => !Number.isNaN(x));

  const assets = (env.ASSETS ?? "USDT,TON,BTC")
    .replace(/\s/g, "")
    .split(",")
    .filter(Boolean)
    .map((a) => a.toUpperCase());

  return {
    cryptopayTestnet: ["1", "true", "yes"].includes((env.CRYPTOPAY_TESTNET ?? "false").toLowerCase()),
    adminIds,
    commissionPercent: parseFloat(env.COMMISSION_PERCENT ?? "5"),
    minAmount: parseFloat(env.MIN_AMOUNT ?? "1"),
    assets: assets.length ? assets : ["USDT", "TON", "BTC"],
  };
}
