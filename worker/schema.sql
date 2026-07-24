-- Схема базы данных D1 (портирована из bot/db.py + таблица FSM-состояний).

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    username    TEXT,
    full_name   TEXT,
    created_at  TEXT NOT NULL,
    is_banned   INTEGER NOT NULL DEFAULT 0,
    is_gold     INTEGER NOT NULL DEFAULT 0
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
    inline_msg_id TEXT,
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

-- Внутренние балансы: сюда падают средства, если автоматическая
-- выплата/возврат через Crypto Pay не прошли. total_out — сколько всего
-- выведено (используется для идемпотентных spend_id при выводе).
CREATE TABLE IF NOT EXISTS balances (
    user_id   INTEGER NOT NULL,
    asset     TEXT NOT NULL,
    amount    REAL NOT NULL DEFAULT 0,
    total_out REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, asset)
);

-- Состояния диалогов (замена aiogram FSM: в Workers нет памяти между запросами).
CREATE TABLE IF NOT EXISTS fsm (
    user_id INTEGER PRIMARY KEY,
    state   TEXT,
    data    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_ratings_to_user ON ratings(to_user);
