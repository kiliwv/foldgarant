from aiogram.fsm.state import State, StatesGroup


class NewDeal(StatesGroup):
    role = State()
    asset = State()
    amount = State()
    description = State()
    confirm = State()


class RateComment(StatesGroup):
    waiting_comment = State()
