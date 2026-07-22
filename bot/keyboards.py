from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

# Настоящие цветные кнопки (Bot API 9.4+, поле style):
#   "success" — зелёная, "danger" — красная, "primary" — синяя.
# Старые клиенты Telegram просто показывают обычную кнопку.
SUCCESS = "success"
DANGER = "danger"
PRIMARY = "primary"

ASSET_EMOJI = {"USDT": "🟢", "TON": "💎", "BTC": "🟠"}


def main_menu() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="🤝 Новая сделка", callback_data="menu:newdeal", style=SUCCESS)
    kb.button(text="📂 Мои сделки", callback_data="menu:mydeals", style=PRIMARY)
    kb.button(text="👤 Профиль", callback_data="menu:profile", style=PRIMARY)
    kb.button(text="ℹ️ Как это работает", callback_data="menu:help")
    kb.adjust(1, 2, 1)
    return kb.as_markup()


def role_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="💼 Я продавец", callback_data="role:seller", style=PRIMARY)
    kb.button(text="🛒 Я покупатель", callback_data="role:buyer", style=PRIMARY)
    kb.button(text="✖️ Отмена", callback_data="newdeal:cancel", style=DANGER)
    kb.adjust(2, 1)
    return kb.as_markup()


def asset_kb(assets: list[str]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for asset in assets:
        emoji = ASSET_EMOJI.get(asset, "💠")
        kb.button(text=f"{emoji} {asset}", callback_data=f"asset:{asset}", style=PRIMARY)
    kb.button(text="✖️ Отмена", callback_data="newdeal:cancel", style=DANGER)
    kb.adjust(len(assets), 1)
    return kb.as_markup()


def confirm_deal_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Создать сделку", callback_data="newdeal:confirm", style=SUCCESS)
    kb.button(text="✖️ Отмена", callback_data="newdeal:cancel", style=DANGER)
    kb.adjust(1)
    return kb.as_markup()


def join_deal_kb(deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="🤝 Присоединиться к сделке",
        callback_data=f"deal:join:{deal_id}",
        style=SUCCESS,
    )
    kb.adjust(1)
    return kb.as_markup()


def processing_kb() -> InlineKeyboardMarkup:
    """Заглушка для inline-сообщения, пока сделка создаётся."""
    kb = InlineKeyboardBuilder()
    kb.button(text="⏳ Создание сделки...", callback_data="noop")
    kb.adjust(1)
    return kb.as_markup()


def pay_kb(pay_url: str, deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.row(
        InlineKeyboardButton(
            text="💳 Оплатить через CryptoBot", url=pay_url, style=SUCCESS
        )
    )
    kb.row(
        InlineKeyboardButton(
            text="✖️ Отменить сделку",
            callback_data=f"deal:cancel:{deal_id}",
            style=DANGER,
        )
    )
    return kb.as_markup()


def cancel_deal_kb(deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="✖️ Отменить сделку", callback_data=f"deal:cancel:{deal_id}", style=DANGER
    )
    kb.adjust(1)
    return kb.as_markup()


def buyer_escrow_kb(deal_id: str) -> InlineKeyboardMarkup:
    """Кнопки покупателя, когда деньги в холде."""
    kb = InlineKeyboardBuilder()
    kb.button(
        text="✅ Я получил товар/услугу",
        callback_data=f"deal:release:{deal_id}",
        style=SUCCESS,
    )
    kb.button(text="⚠️ Открыть спор", callback_data=f"deal:dispute:{deal_id}", style=DANGER)
    kb.adjust(1)
    return kb.as_markup()


def seller_escrow_kb(deal_id: str) -> InlineKeyboardMarkup:
    """Кнопки продавца, когда деньги в холде."""
    kb = InlineKeyboardBuilder()
    kb.button(
        text="↩️ Вернуть деньги покупателю",
        callback_data=f"deal:refund:{deal_id}",
        style=PRIMARY,
    )
    kb.button(text="⚠️ Открыть спор", callback_data=f"deal:dispute:{deal_id}", style=DANGER)
    kb.adjust(1)
    return kb.as_markup()


def confirm_release_kb(deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="✅ Да, подтверждаю", callback_data=f"deal:release2:{deal_id}", style=SUCCESS
    )
    kb.button(text="↩️ Назад", callback_data=f"deal:back:{deal_id}")
    kb.adjust(1)
    return kb.as_markup()


def rate_kb(deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="👍", callback_data=f"rate:{deal_id}:1", style=SUCCESS)
    kb.button(text="👎", callback_data=f"rate:{deal_id}:-1", style=DANGER)
    kb.adjust(2)
    return kb.as_markup()


def skip_comment_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="⏭ Пропустить", callback_data="rate:skip_comment")
    kb.adjust(1)
    return kb.as_markup()


def dispute_resolve_kb(deal_id: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="💸 Выплатить продавцу",
        callback_data=f"resolve:release:{deal_id}",
        style=SUCCESS,
    )
    kb.button(
        text="↩️ Вернуть покупателю",
        callback_data=f"resolve:refund:{deal_id}",
        style=DANGER,
    )
    kb.adjust(1)
    return kb.as_markup()
