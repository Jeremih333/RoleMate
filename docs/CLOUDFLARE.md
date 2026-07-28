# Cloudflare: D1, Data API и App Worker

Подключение выполняется интерактивно, без передачи API token в репозиторий:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler login
```

CLI откроет браузер для входа владельца. Затем создаются preview и production D1:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 create rolemate-preview
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 create rolemate-production
```

IDs вносятся в `apps/d1-worker/wrangler.toml`. Общий HMAC secret задаётся
интерактивно:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler secret put INTERNAL_API_SECRET
```

Сначала применяются preview migrations и выполняется smoke:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 migrations apply rolemate-preview --remote
corepack pnpm --filter @rolemate/d1-worker deploy
```

Только после preview-проверки миграции применяются к `rolemate-production`.
Data API принимает лишь `/v1/execute` с разрешёнными операциями, HMAC,
timestamp и одноразовым nonce; произвольный SQL через HTTP отсутствует.

## Единый App Worker

`apps/bot-api/wrangler.toml` описывает production без Northflank:

- Worker-native HTTP adapter принимает webhook и все `/api/*` маршруты;
- service binding `DATA_API` обращается к Data API Worker;
- Static Assets раздают Mini App и фирменные изображения;
- Cron Trigger запускает dispatcher рассылок;
- `nodejs_compat` включён для поддерживаемых Node API;
- Fastify заменяется при Worker-сборке через официальный Wrangler module alias.

Перед первым deploy задайте четыре секрета. Значения вводятся в скрытом prompt
Wrangler и не попадают в shell history:

```powershell
corepack pnpm --filter @rolemate/bot-api exec wrangler secret put TELEGRAM_BOT_TOKEN
corepack pnpm --filter @rolemate/bot-api exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
corepack pnpm --filter @rolemate/bot-api exec wrangler secret put INTERNAL_API_SECRET
corepack pnpm --filter @rolemate/bot-api exec wrangler secret put SESSION_SECRET
```

Проверка и deploy:

```powershell
corepack pnpm build:cloudflare
powershell -ExecutionPolicy Bypass -File toolkit/test-cloudflare-runtime.ps1
corepack pnpm --filter @rolemate/bot-api deploy:cloudflare
```

Production URL: `https://rolemate-app.<account>.workers.dev`. После deploy
`scripts/setup-telegram.ts` связывает с ним webhook и кнопку Mini App.

Актуальные free limits на момент проверки 2026-07-28:

- Workers: 100 000 динамических запросов в сутки, 10 мс CPU на запрос,
  128 МБ памяти и bundle до 3 МБ gzip;
- D1: 5 ГБ суммарно, 5 млн прочитанных и 100 000 записанных строк в сутки;
- запросы к Static Assets бесплатны и не расходуют лимит Worker requests.

При достижении бесплатного лимита Cloudflare возвращает ошибку лимита, но не
списывает деньги автоматически.
