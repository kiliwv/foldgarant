// Минимальный клиент Crypto Pay API (@CryptoBot) поверх fetch.
// Документация: https://help.crypt.bot/crypto-pay-api

const MAINNET_URL = "https://pay.crypt.bot/api";
const TESTNET_URL = "https://testnet-pay.crypt.bot/api";

export class CryptoPayError extends Error {
  constructor(
    public code: number,
    public errorName: string,
  ) {
    super(`CryptoPay error ${code}: ${errorName}`);
  }
}

export interface Invoice {
  invoice_id: number;
  status: string; // active | paid | expired
  asset: string;
  amount: string;
  bot_invoice_url: string;
  payload?: string;
}

export class CryptoPay {
  private baseUrl: string;

  constructor(
    private token: string,
    testnet = false,
  ) {
    this.baseUrl = testnet ? TESTNET_URL : MAINNET_URL;
  }

  private async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) payload[k] = v;
    }
    const resp = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Crypto-Pay-API-Token": this.token,
      },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as {
      ok: boolean;
      result?: T;
      error?: { code?: number; name?: string };
    };
    if (!data.ok) {
      throw new CryptoPayError(data.error?.code ?? 0, data.error?.name ?? "UNKNOWN");
    }
    return data.result as T;
  }

  getMe() {
    return this.request<{ name?: string }>("getMe");
  }

  createInvoice(opts: {
    asset: string;
    amount: number;
    description?: string;
    payload?: string;
    expires_in?: number;
  }): Promise<Invoice> {
    return this.request<Invoice>("createInvoice", {
      currency_type: "crypto",
      asset: opts.asset,
      amount: String(opts.amount),
      description: opts.description,
      payload: opts.payload,
      expires_in: opts.expires_in,
    });
  }

  async getInvoices(invoiceIds: number[]): Promise<Invoice[]> {
    const result = await this.request<{ items?: Invoice[] }>("getInvoices", {
      invoice_ids: invoiceIds.join(","),
    });
    return result.items ?? [];
  }

  /** Выплата пользователю. spendId — ключ идемпотентности. */
  transfer(opts: {
    user_id: number;
    asset: string;
    amount: number;
    spend_id: string;
    comment?: string;
  }) {
    return this.request("transfer", {
      user_id: opts.user_id,
      asset: opts.asset,
      amount: String(opts.amount),
      spend_id: opts.spend_id,
      comment: opts.comment,
      disable_send_notification: false,
    });
  }

  getBalance() {
    return this.request<{ currency_code: string; available: string }[]>("getBalance");
  }
}

/**
 * Проверка подписи вебхука Crypto Pay:
 * заголовок crypto-pay-api-signature = HMAC-SHA256(body), ключ — SHA256(token).
 */
export async function checkCryptoPaySignature(
  token: string,
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(token));
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature.toLowerCase();
}
