import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    bot_token: str
    cryptopay_token: str
    cryptopay_testnet: bool
    admin_ids: list[int]
    commission_percent: float
    min_amount: float
    db_path: str
    assets: list[str] = field(default_factory=lambda: ["USDT", "TON", "BTC"])


def load_config() -> Config:
    bot_token = os.getenv("BOT_TOKEN", "")
    cryptopay_token = os.getenv("CRYPTOPAY_TOKEN", "")
    if not bot_token:
        raise RuntimeError("BOT_TOKEN не задан (см. .env.example)")
    if not cryptopay_token:
        raise RuntimeError("CRYPTOPAY_TOKEN не задан (см. .env.example)")

    admin_ids = [
        int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x
    ]

    return Config(
        bot_token=bot_token,
        cryptopay_token=cryptopay_token,
        cryptopay_testnet=os.getenv("CRYPTOPAY_TESTNET", "false").lower()
        in ("1", "true", "yes"),
        admin_ids=admin_ids,
        commission_percent=float(os.getenv("COMMISSION_PERCENT", "5")),
        min_amount=float(os.getenv("MIN_AMOUNT", "1")),
        db_path=os.getenv("DB_PATH", "guarantor.db"),
    )
