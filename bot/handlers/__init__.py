from aiogram import Dispatcher

from . import admin, deals, profile, ratings, start


def setup_routers(dp: Dispatcher) -> None:
    dp.include_router(start.router)
    dp.include_router(profile.router)
    dp.include_router(deals.router)
    dp.include_router(ratings.router)
    dp.include_router(admin.router)
