"""Слой работы с базой данных (SQLite, aiosqlite)."""

import secrets
from datetime import datetime, timezone

import aiosqlite

# Статусы сделки
WAITING_PARTY = "waiting_party"      # ждём второго участника
WAITING_PAYMENT = "waiting_payment"  # ждём оплату покупателем
PAID = "paid"                        # деньги в холде у гаранта
COMPLETED = "completed"              # выплачено продавцу
REFUNDED = "refunded"                # возвращено покупателю
DISPUTED = "disputed"                # открыт спор
CANCELLED = "cancelled"              # отменена до оплаты

ACTIVE_STATUSES = (WAITING_PARTY, WAITING_PAYMENT, PAID, DISPUTED)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    username    TEXT,
    full_name   TEXT,
    created_at  TEXT NOT NULL,
    is_banned   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
    id           TEXT PRIMARY KEY,
    creator_id   INTEGER NOT NULL REFERENCES users(id),
    seller_id    INTEGER REFERENCES users(id),
    buyer_id     INTEGER REFERENCES users(id),
    asset        TEXT NOT NULL,
    amount       REAL NOT NULL,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL,
    invoice_id   INTEGER,
    pay_url      TEXT,
    created_at   TEXT NOT NULL,
    closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS ratings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id    TEXT NOT NULL REFERENCES deals(id),
    from_user  INTEGER NOT NULL REFERENCES users(id),
    to_user    INTEGER NOT NULL REFERENCES users(id),
    score      INTEGER NOT NULL,          -- +1 или -1
    comment    TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (deal_id, from_user)
);

CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_ratings_to_user ON ratings(to_user);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: str):
        self._path = path
        self._db: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._db = await aiosqlite.connect(self._path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "Database is not connected"
        return self._db

    # --- Пользователи -----------------------------------------------------

    async def upsert_user(self, user_id: int, username: str | None, full_name: str) -> None:
        await self.db.execute(
            """INSERT INTO users (id, username, full_name, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET username = excluded.username,
                                             full_name = excluded.full_name""",
            (user_id, username, full_name, _now()),
        )
        await self.db.commit()

    async def get_user(self, user_id: int) -> aiosqlite.Row | None:
        cur = await self.db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return await cur.fetchone()

    async def set_banned(self, user_id: int, banned: bool) -> None:
        await self.db.execute(
            "UPDATE users SET is_banned = ? WHERE id = ?", (int(banned), user_id)
        )
        await self.db.commit()

    # --- Сделки -----------------------------------------------------------

    async def create_deal(
        self,
        creator_id: int,
        creator_role: str,  # "seller" | "buyer"
        asset: str,
        amount: float,
        description: str,
    ) -> str:
        deal_id = secrets.token_hex(4).upper()
        seller_id = creator_id if creator_role == "seller" else None
        buyer_id = creator_id if creator_role == "buyer" else None
        await self.db.execute(
            """INSERT INTO deals (id, creator_id, seller_id, buyer_id, asset,
                                  amount, description, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (deal_id, creator_id, seller_id, buyer_id, asset, amount,
             description, WAITING_PARTY, _now()),
        )
        await self.db.commit()
        return deal_id

    async def get_deal(self, deal_id: str) -> aiosqlite.Row | None:
        cur = await self.db.execute("SELECT * FROM deals WHERE id = ?", (deal_id,))
        return await cur.fetchone()

    async def join_deal(self, deal_id: str, user_id: int) -> None:
        """Второй участник занимает свободную роль."""
        deal = await self.get_deal(deal_id)
        assert deal is not None
        field = "seller_id" if deal["seller_id"] is None else "buyer_id"
        await self.db.execute(
            f"UPDATE deals SET {field} = ?, status = ? WHERE id = ?",
            (user_id, WAITING_PAYMENT, deal_id),
        )
        await self.db.commit()

    async def set_invoice(self, deal_id: str, invoice_id: int, pay_url: str) -> None:
        await self.db.execute(
            "UPDATE deals SET invoice_id = ?, pay_url = ? WHERE id = ?",
            (invoice_id, pay_url, deal_id),
        )
        await self.db.commit()

    async def set_status(self, deal_id: str, status: str) -> None:
        closed_at = _now() if status in (COMPLETED, REFUNDED, CANCELLED) else None
        await self.db.execute(
            "UPDATE deals SET status = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?",
            (status, closed_at, deal_id),
        )
        await self.db.commit()

    async def deals_waiting_payment(self) -> list[aiosqlite.Row]:
        cur = await self.db.execute(
            "SELECT * FROM deals WHERE status = ? AND invoice_id IS NOT NULL",
            (WAITING_PAYMENT,),
        )
        return list(await cur.fetchall())

    async def user_active_deals(self, user_id: int) -> list[aiosqlite.Row]:
        placeholders = ",".join("?" for _ in ACTIVE_STATUSES)
        cur = await self.db.execute(
            f"""SELECT * FROM deals
                WHERE (seller_id = ? OR buyer_id = ?) AND status IN ({placeholders})
                ORDER BY created_at DESC""",
            (user_id, user_id, *ACTIVE_STATUSES),
        )
        return list(await cur.fetchall())

    async def disputed_deals(self) -> list[aiosqlite.Row]:
        cur = await self.db.execute(
            "SELECT * FROM deals WHERE status = ? ORDER BY created_at", (DISPUTED,)
        )
        return list(await cur.fetchall())

    # --- Репутация ----------------------------------------------------------

    async def add_rating(
        self, deal_id: str, from_user: int, to_user: int, score: int,
        comment: str | None = None,
    ) -> bool:
        """False, если оценка по этой сделке уже была."""
        try:
            await self.db.execute(
                """INSERT INTO ratings (deal_id, from_user, to_user, score, comment, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (deal_id, from_user, to_user, score, comment, _now()),
            )
            await self.db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False

    async def set_rating_comment(self, deal_id: str, from_user: int, comment: str) -> None:
        await self.db.execute(
            "UPDATE ratings SET comment = ? WHERE deal_id = ? AND from_user = ?",
            (comment, deal_id, from_user),
        )
        await self.db.commit()

    async def user_stats(self, user_id: int) -> dict:
        cur = await self.db.execute(
            """SELECT COUNT(*) AS cnt FROM deals
               WHERE (seller_id = ? OR buyer_id = ?) AND status = ?""",
            (user_id, user_id, COMPLETED),
        )
        completed = (await cur.fetchone())["cnt"]

        cur = await self.db.execute(
            """SELECT asset, SUM(amount) AS volume FROM deals
               WHERE (seller_id = ? OR buyer_id = ?) AND status = ?
               GROUP BY asset""",
            (user_id, user_id, COMPLETED),
        )
        volumes = {row["asset"]: row["volume"] for row in await cur.fetchall()}

        cur = await self.db.execute(
            """SELECT
                 SUM(CASE WHEN score > 0 THEN 1 ELSE 0 END) AS positive,
                 SUM(CASE WHEN score < 0 THEN 1 ELSE 0 END) AS negative
               FROM ratings WHERE to_user = ?""",
            (user_id,),
        )
        row = await cur.fetchone()
        return {
            "completed": completed,
            "volumes": volumes,
            "positive": row["positive"] or 0,
            "negative": row["negative"] or 0,
        }

    async def last_reviews(self, user_id: int, limit: int = 3) -> list[aiosqlite.Row]:
        cur = await self.db.execute(
            """SELECT r.*, u.username AS from_username FROM ratings r
               LEFT JOIN users u ON u.id = r.from_user
               WHERE r.to_user = ? AND r.comment IS NOT NULL AND r.comment != ''
               ORDER BY r.created_at DESC LIMIT ?""",
            (user_id, limit),
        )
        return list(await cur.fetchall())
