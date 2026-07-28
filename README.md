# RoleMate

RoleMate — Telegram-бот и Mini App для безопасного поиска партнёров по текстовым
ролевым играм. Пользователи создают подробные анкеты, отмечают симпатии, получают
мэтчи и общаются через анонимный relay. Исходный Telegram-отправитель не
раскрывается: бот создаёт новое сообщение или безопасно копирует поддерживаемое
медиа без forward attribution.

## Возможности

- онбординг с возрастной категорией и правилами;
- анкета с фандомами, жанрами, стилем письма, границами и фильтром контактов;
- поиск, симпатии, мэтчи, блокировки и жалобы;
- анонимные текстовые и медиа-сообщения с сохранением reply chain;
- Telegram Stars: разовые тарифы, подписка, идемпотентная обработка и возвраты;
- реферальная награда ровно 24 часа Premium после квалификации;
- Telegram-native CAPTCHA и Cloudflare Turnstile по risk score;
- скрытая server-side защищённая admin Mini App для владельца `1040929628`;
- одна нормализованная Cloudflare D1, доступная только через подписанный Data API.

YooKassa намеренно выключена для цифрового Premium в Telegram.

## Архитектура

```text
Telegram / Mini App
        |
        v
Fastify + grammY (Northflank)
        |
        | HMAC + timestamp + one-time nonce
        v
Cloudflare Worker Data API
        |
        v
Cloudflare D1
```

Подробнее: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Требования

- Node.js 22–24;
- Corepack и pnpm 10;
- Cloudflare-аккаунт для D1/Worker;
- публичный HTTPS-сервис (production рассчитан на Northflank);
- Telegram bot token.

## Локальный запуск

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 migrations apply rolemate-production --local
corepack pnpm dev
```

Заполните `.env` своими значениями. Никогда не коммитьте токены. Минимальные
секреты: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`INTERNAL_API_SECRET`, `SESSION_SECRET`. Сгенерировать секрет можно командой:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Mini App использует валидный `Telegram.WebApp.initData`. Для локального UI-only
просмотра Playwright применяет контролируемые моки, production API мок не
принимает.

## Проверки

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
powershell -ExecutionPolicy Bypass -File toolkit/verify.ps1
```

`toolkit/` создан до реализации проекта и содержит повторяемые audit,
secret-scan и verification-инструменты. Полная матрица: [TESTING.md](TESTING.md).

## Развёртывание

1. Выполните вход и создайте D1/Worker по [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).
2. Примените миграции сначала к preview, выполните smoke test, затем к production.
3. Соберите и разверните `Dockerfile` по [docs/NORTHFLANK.md](docs/NORTHFLANK.md).
4. Добавьте runtime secrets в панели хостинга, а не в образ.
5. После появления HTTPS URL выполните:

```powershell
$env:PUBLIC_BASE_URL='https://<service>.northflank.app'
$env:MINI_APP_URL=$env:PUBLIC_BASE_URL
corepack pnpm tsx scripts/setup-telegram.ts
corepack pnpm tsx scripts/check-webhook.ts
```

Health endpoints: `/health/startup`, `/health/ready`, `/health/live`; сведения о
сборке: `/version`.

## Безопасность и правила

См. [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md) и [TERMS.md](TERMS.md).
Поддержка: [@odinnadsat](https://t.me/odinnadsat). Проект создан при поддержке
пиар-чата [@piarchaticksss](https://t.me/piarchaticksss).
