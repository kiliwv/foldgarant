# ☁️ Хостинг бота на Cloudflare Workers

Это полный порт бота на TypeScript для Cloudflare Workers — функциональность
идентична Python-версии (сделки, inline-режим, оплата через CryptoBot, споры,
репутация, админка). Отличия только в способе работы:

| | Python-версия (`../`) | Cloudflare Workers (`worker/`) |
|---|---|---|
| Получение обновлений | long polling | вебхук Telegram |
| База данных | локальный SQLite | Cloudflare D1 (SQLite в облаке) |
| Проверка оплаты | фоновый цикл каждые 15 с | вебхук Crypto Pay + cron раз в минуту |
| Где работает | ваш сервер/VPS | бессерверно у Cloudflare (есть бесплатный тариф) |

Бесплатного тарифа Workers (100 000 запросов/день) и D1 хватит с запасом.

## Деплой (один раз, ~10 минут)

Понадобится [аккаунт Cloudflare](https://dash.cloudflare.com/sign-up) (бесплатный)
и Node.js 18+.

### 1. Установка и вход

```bash
cd worker
npm install
npx wrangler login   # откроет браузер для входа в Cloudflare
```

### 2. База данных D1

```bash
npm run db:create
```

Команда выведет `database_id` — вставьте его в `wrangler.jsonc` вместо
`ЗАМЕНИТЕ_НА_ID_ИЗ_npm_run_db:create`. Затем примените схему:

```bash
npm run db:schema
```

### 3. Секреты

```bash
npx wrangler secret put BOT_TOKEN        # токен от @BotFather
npx wrangler secret put CRYPTOPAY_TOKEN  # токен Crypto Pay от @CryptoBot
npx wrangler secret put WEBHOOK_SECRET   # случайная строка, например: openssl rand -hex 32
```

`WEBHOOK_SECRET` — произвольная случайная строка (латиница/цифры/`_`/`-`),
она защищает вебхук и страницу настройки.

### 4. Настройки (по желанию)

В `wrangler.jsonc` в блоке `vars`:

- `ADMIN_IDS` — ID администраторов через запятую (узнать: @userinfobot);
- `COMMISSION_PERCENT` — комиссия сервиса в процентах;
- `MIN_AMOUNT` — минимальная сумма сделки;
- `CRYPTOPAY_TESTNET` — `true` для @CryptoTestnetBot;
- `ASSETS` — доступные валюты через запятую.

### 5. Деплой и регистрация вебхука

```bash
npm run deploy
```

Wrangler выведет адрес воркера вида `https://foldgarant.<аккаунт>.workers.dev`.
Откройте в браузере (подставьте свой адрес и секрет):

```
https://foldgarant.<аккаунт>.workers.dev/setup?secret=<WEBHOOK_SECRET>
```

Эта страница зарегистрирует вебхук Telegram и команды бота. Готово — бот работает.

### 6. Вебхук Crypto Pay (рекомендуется)

Чтобы оплата засчитывалась мгновенно, укажите в @CryptoBot →
Crypto Pay → My Apps → ваше приложение → Webhooks адрес:

```
https://foldgarant.<аккаунт>.workers.dev/cryptopay/webhook
```

Без этого тоже всё работает: cron проверяет счета раз в минуту.

### 7. Inline-режим (сделка через `@имя_бота` в чате)

У @BotFather:
- `/setinline` → placeholder, например `сумма валюта описание`;
- `/setinlinefeedback` → **Enabled (100%)**.

## Обновление

После изменения кода — просто `npm run deploy` ещё раз.

## Полезные команды

```bash
npm run tail          # живые логи воркера
npm run typecheck     # проверка типов
npx wrangler d1 execute foldgarant --remote --command "SELECT * FROM deals"  # запрос к базе
```

## Локальная разработка

```bash
cp .dev.vars.example .dev.vars   # заполните значения
npm run db:schema:local
npm run dev
```

`wrangler dev` поднимает воркер локально; чтобы Telegram мог доставить
вебхук, пробросьте его наружу (например, `cloudflared tunnel --url http://localhost:8787`)
и вызовите `/setup` по внешнему адресу.

## Структура

```
wrangler.jsonc        — конфигурация Worker (D1, cron, переменные)
schema.sql            — схема базы D1
src/
  index.ts            — входная точка: маршруты вебхуков, /setup, cron
  config.ts           — конфигурация из переменных окружения
  telegram.ts         — клиент Telegram Bot API
  cryptopay.ts        — клиент Crypto Pay API + проверка подписи вебхука
  db.ts               — работа с D1: пользователи, сделки, оценки, FSM-состояния
  services.ts         — выплаты/возвраты/уведомления, перевод сделки в холд
  keyboards.ts        — inline-клавиатуры
  utils.ts            — форматирование карточек сделок и репутации
  handlers/
    update.ts         — диспетчер обновлений + проверка бана
    messages.ts       — команды и шаги диалогов (FSM)
    callbacks.ts      — обработка кнопок
    inline.ts         — сделка через @имя_бота прямо в чате
```
