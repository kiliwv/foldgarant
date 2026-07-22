// Слой работы с базой данных (Cloudflare D1), порт bot/db.py.

// Статусы сделки
export const WAITING_PARTY = "waiting_party"; // ждём второго участника
export const WAITING_PAYMENT = "waiting_payment"; // ждём оплату покупателем
export const PAID = "paid"; // деньги в холде у гаранта
export const COMPLETED = "completed"; // выплачено продавцу
export const REFUNDED = "refunded"; // возвращено покупателю
export const DISPUTED = "disputed"; // открыт спор
export const CANCELLED = "cancelled"; // отменена до оплаты

export const ACTIVE_STATUSES = [WAITING_PARTY, WAITING_PAYMENT, PAID, DISPUTED];

export interface UserRow {
  id: number;
  username: string | null;
  full_name: string | null;
  created_at: string;
  is_banned: number;
}

export interface DealRow {
  id: string;
  creator_id: number;
  seller_id: number | null;
  buyer_id: number | null;
  asset: string;
  amount: number;
  description: string;
  status: string;
  invoice_id: number | null;
  pay_url: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface RatingRow {
  id: number;
  deal_id: string;
  from_user: number;
  to_user: number;
  score: number;
  comment: string | null;
  created_at: string;
  from_username?: string | null;
}

export interface UserStats {
  completed: number;
  volumes: Record<string, number>;
  positive: number;
  negative: number;
}

export interface BalanceRow {
  user_id: number;
  asset: string;
  amount: number;
  total_out: number;
}

export interface FsmState {
  state: string | null;
  data: Record<string, unknown>;
}

function now(): string {
  return new Date().toISOString();
}

function newDealId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export class Db {
  constructor(private d1: D1Database) {}

  // --- Пользователи -----------------------------------------------------

  async upsertUser(userId: number, username: string | null, fullName: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO users (id, username, full_name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username,
                                       full_name = excluded.full_name`,
      )
      .bind(userId, username, fullName, now())
      .run();
  }

  async getUser(userId: number): Promise<UserRow | null> {
    return await this.d1.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    return await this.d1
      .prepare(
        "SELECT * FROM users WHERE username = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1",
      )
      .bind(username)
      .first<UserRow>();
  }

  async setBanned(userId: number, banned: boolean): Promise<void> {
    await this.d1
      .prepare("UPDATE users SET is_banned = ? WHERE id = ?")
      .bind(banned ? 1 : 0, userId)
      .run();
  }

  // --- Сделки -----------------------------------------------------------

  async createDeal(
    creatorId: number,
    creatorRole: "seller" | "buyer",
    asset: string,
    amount: number,
    description: string,
  ): Promise<string> {
    const dealId = newDealId();
    const sellerId = creatorRole === "seller" ? creatorId : null;
    const buyerId = creatorRole === "buyer" ? creatorId : null;
    await this.d1
      .prepare(
        `INSERT INTO deals (id, creator_id, seller_id, buyer_id, asset,
                            amount, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(dealId, creatorId, sellerId, buyerId, asset, amount, description, WAITING_PARTY, now())
      .run();
    return dealId;
  }

  async getDeal(dealId: string): Promise<DealRow | null> {
    return await this.d1.prepare("SELECT * FROM deals WHERE id = ?").bind(dealId).first<DealRow>();
  }

  /** Второй участник занимает свободную роль. */
  async joinDeal(dealId: string, userId: number): Promise<void> {
    const deal = await this.getDeal(dealId);
    if (!deal) throw new Error(`Deal ${dealId} not found`);
    const field = deal.seller_id === null ? "seller_id" : "buyer_id";
    await this.d1
      .prepare(`UPDATE deals SET ${field} = ?, status = ? WHERE id = ?`)
      .bind(userId, WAITING_PAYMENT, dealId)
      .run();
  }

  async setInvoice(dealId: string, invoiceId: number, payUrl: string): Promise<void> {
    await this.d1
      .prepare("UPDATE deals SET invoice_id = ?, pay_url = ? WHERE id = ?")
      .bind(invoiceId, payUrl, dealId)
      .run();
  }

  async setStatus(dealId: string, status: string): Promise<void> {
    const closedAt = [COMPLETED, REFUNDED, CANCELLED].includes(status) ? now() : null;
    await this.d1
      .prepare("UPDATE deals SET status = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?")
      .bind(status, closedAt, dealId)
      .run();
  }

  async dealsWaitingPayment(): Promise<DealRow[]> {
    const res = await this.d1
      .prepare("SELECT * FROM deals WHERE status = ? AND invoice_id IS NOT NULL")
      .bind(WAITING_PAYMENT)
      .all<DealRow>();
    return res.results;
  }

  async userActiveDeals(userId: number): Promise<DealRow[]> {
    const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
    const res = await this.d1
      .prepare(
        `SELECT * FROM deals
         WHERE (seller_id = ? OR buyer_id = ?) AND status IN (${placeholders})
         ORDER BY created_at DESC`,
      )
      .bind(userId, userId, ...ACTIVE_STATUSES)
      .all<DealRow>();
    return res.results;
  }

  async countsByStatus(): Promise<Record<string, number>> {
    const res = await this.d1
      .prepare("SELECT status, COUNT(*) AS cnt FROM deals GROUP BY status")
      .all<{ status: string; cnt: number }>();
    const out: Record<string, number> = {};
    for (const row of res.results) out[row.status] = row.cnt;
    return out;
  }

  async dealsByStatus(status: string, limit = 10): Promise<DealRow[]> {
    const res = await this.d1
      .prepare("SELECT * FROM deals WHERE status = ? ORDER BY created_at LIMIT ?")
      .bind(status, limit)
      .all<DealRow>();
    return res.results;
  }

  async userClosedDeals(userId: number, limit = 10): Promise<DealRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT * FROM deals
         WHERE (seller_id = ? OR buyer_id = ? OR creator_id = ?)
           AND status IN (?, ?, ?)
         ORDER BY COALESCE(closed_at, created_at) DESC LIMIT ?`,
      )
      .bind(userId, userId, userId, COMPLETED, REFUNDED, CANCELLED, limit)
      .all<DealRow>();
    return res.results;
  }

  async disputedDeals(): Promise<DealRow[]> {
    const res = await this.d1
      .prepare("SELECT * FROM deals WHERE status = ? ORDER BY created_at")
      .bind(DISPUTED)
      .all<DealRow>();
    return res.results;
  }

  // --- Репутация ----------------------------------------------------------

  /** false, если оценка по этой сделке уже была. */
  async addRating(
    dealId: string,
    fromUser: number,
    toUser: number,
    score: number,
    comment: string | null = null,
  ): Promise<boolean> {
    const res = await this.d1
      .prepare(
        `INSERT OR IGNORE INTO ratings (deal_id, from_user, to_user, score, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(dealId, fromUser, toUser, score, comment, now())
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async hasRating(dealId: string, fromUser: number): Promise<boolean> {
    const row = await this.d1
      .prepare("SELECT 1 AS x FROM ratings WHERE deal_id = ? AND from_user = ?")
      .bind(dealId, fromUser)
      .first();
    return row !== null;
  }

  async setRatingComment(dealId: string, fromUser: number, comment: string): Promise<void> {
    await this.d1
      .prepare("UPDATE ratings SET comment = ? WHERE deal_id = ? AND from_user = ?")
      .bind(comment, dealId, fromUser)
      .run();
  }

  async userStats(userId: number): Promise<UserStats> {
    const completedRow = await this.d1
      .prepare(
        `SELECT COUNT(*) AS cnt FROM deals
         WHERE (seller_id = ? OR buyer_id = ?) AND status = ?`,
      )
      .bind(userId, userId, COMPLETED)
      .first<{ cnt: number }>();

    const volumeRows = await this.d1
      .prepare(
        `SELECT asset, SUM(amount) AS volume FROM deals
         WHERE (seller_id = ? OR buyer_id = ?) AND status = ?
         GROUP BY asset`,
      )
      .bind(userId, userId, COMPLETED)
      .all<{ asset: string; volume: number }>();
    const volumes: Record<string, number> = {};
    for (const row of volumeRows.results) volumes[row.asset] = row.volume;

    const ratingRow = await this.d1
      .prepare(
        `SELECT
           SUM(CASE WHEN score > 0 THEN 1 ELSE 0 END) AS positive,
           SUM(CASE WHEN score < 0 THEN 1 ELSE 0 END) AS negative
         FROM ratings WHERE to_user = ?`,
      )
      .bind(userId)
      .first<{ positive: number | null; negative: number | null }>();

    return {
      completed: completedRow?.cnt ?? 0,
      volumes,
      positive: ratingRow?.positive ?? 0,
      negative: ratingRow?.negative ?? 0,
    };
  }

  async lastReviews(userId: number, limit = 3): Promise<RatingRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT r.*, u.username AS from_username FROM ratings r
         LEFT JOIN users u ON u.id = r.from_user
         WHERE r.to_user = ? AND r.comment IS NOT NULL AND r.comment != ''
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(userId, limit)
      .all<RatingRow>();
    return res.results;
  }

  // --- Внутренние балансы ---------------------------------------------------

  /** Создаёт таблицу балансов (миграция для баз, созданных до её появления). */
  async ensureBalancesTable(): Promise<void> {
    await this.d1
      .prepare(
        `CREATE TABLE IF NOT EXISTS balances (
           user_id   INTEGER NOT NULL,
           asset     TEXT NOT NULL,
           amount    REAL NOT NULL DEFAULT 0,
           total_out REAL NOT NULL DEFAULT 0,
           PRIMARY KEY (user_id, asset)
         )`,
      )
      .run();
  }

  async getBalances(userId: number): Promise<BalanceRow[]> {
    const res = await this.d1
      .prepare("SELECT * FROM balances WHERE user_id = ? AND amount > 0")
      .bind(userId)
      .all<BalanceRow>();
    return res.results;
  }

  async creditBalance(userId: number, asset: string, amount: number): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO balances (user_id, asset, amount) VALUES (?, ?, ?)
         ON CONFLICT(user_id, asset) DO UPDATE SET amount = amount + excluded.amount`,
      )
      .bind(userId, asset, amount)
      .run();
  }

  /** Обнуляет баланс после успешного вывода, фиксируя новую сумму выведенного. */
  async settleWithdrawal(userId: number, asset: string, newTotalOut: number): Promise<void> {
    await this.d1
      .prepare("UPDATE balances SET amount = 0, total_out = ? WHERE user_id = ? AND asset = ?")
      .bind(newTotalOut, userId, asset)
      .run();
  }

  // --- FSM-состояния диалогов ----------------------------------------------

  async getState(userId: number): Promise<FsmState> {
    const row = await this.d1
      .prepare("SELECT state, data FROM fsm WHERE user_id = ?")
      .bind(userId)
      .first<{ state: string | null; data: string }>();
    if (!row) return { state: null, data: {} };
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data);
    } catch {
      // повреждённые данные считаем пустыми
    }
    return { state: row.state, data };
  }

  async setState(userId: number, state: string | null, data: Record<string, unknown>): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO fsm (user_id, state, data) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, data = excluded.data`,
      )
      .bind(userId, state, JSON.stringify(data))
      .run();
  }

  async clearState(userId: number): Promise<void> {
    await this.d1.prepare("DELETE FROM fsm WHERE user_id = ?").bind(userId).run();
  }
}
