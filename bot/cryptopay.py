"""Минимальный асинхронный клиент Crypto Pay API (@CryptoBot).

Документация: https://help.crypt.bot/crypto-pay-api
"""

from typing import Any

import aiohttp

MAINNET_URL = "https://pay.crypt.bot/api"
TESTNET_URL = "https://testnet-pay.crypt.bot/api"


class CryptoPayError(Exception):
    def __init__(self, code: int, name: str):
        self.code = code
        self.name = name
        super().__init__(f"CryptoPay error {code}: {name}")


class CryptoPay:
    def __init__(self, token: str, testnet: bool = False):
        self._token = token
        self._base_url = TESTNET_URL if testnet else MAINNET_URL
        self._session: aiohttp.ClientSession | None = None

    async def _request(self, method: str, **params: Any) -> Any:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Crypto-Pay-API-Token": self._token}
            )
        payload = {k: v for k, v in params.items() if v is not None}
        async with self._session.post(
            f"{self._base_url}/{method}", json=payload
        ) as resp:
            data = await resp.json()
        if not data.get("ok"):
            err = data.get("error", {})
            raise CryptoPayError(err.get("code", 0), err.get("name", "UNKNOWN"))
        return data["result"]

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def get_me(self) -> dict:
        return await self._request("getMe")

    async def create_invoice(
        self,
        asset: str,
        amount: float,
        description: str | None = None,
        payload: str | None = None,
        expires_in: int | None = None,
    ) -> dict:
        return await self._request(
            "createInvoice",
            currency_type="crypto",
            asset=asset,
            amount=str(amount),
            description=description,
            payload=payload,
            expires_in=expires_in,
        )

    async def get_invoices(self, invoice_ids: list[int]) -> list[dict]:
        result = await self._request(
            "getInvoices", invoice_ids=",".join(map(str, invoice_ids))
        )
        return result.get("items", [])

    async def transfer(
        self,
        user_id: int,
        asset: str,
        amount: float,
        spend_id: str,
        comment: str | None = None,
    ) -> dict:
        """Выплата пользователю. spend_id — ключ идемпотентности."""
        return await self._request(
            "transfer",
            user_id=user_id,
            asset=asset,
            amount=str(amount),
            spend_id=spend_id,
            comment=comment,
            disable_send_notification=False,
        )

    async def get_balance(self) -> list[dict]:
        return await self._request("getBalance")
