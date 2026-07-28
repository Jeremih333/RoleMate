# Cloudflare D1 и Worker

Подключение выполняется интерактивно, без передачи API token в репозиторий:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler login
```

CLI откроет браузер для входа владельца. Затем:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 create rolemate-preview
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 create rolemate-production
```

Полученные IDs внесите в `apps/d1-worker/wrangler.toml`. Общий HMAC secret
создайте локально и задайте Worker-командой:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler secret put INTERNAL_API_SECRET
```

Сначала применяются preview migrations и выполняются smoke tests:

```powershell
corepack pnpm --filter @rolemate/d1-worker exec wrangler d1 migrations apply rolemate-preview --remote
corepack pnpm --filter @rolemate/d1-worker deploy
```

Только после preview проверки миграции применяются к `rolemate-production`.
Worker принимает лишь `/v1/execute` с разрешёнными операциями, HMAC, timestamp и
одноразовым nonce; произвольный SQL через HTTP отсутствует.

Актуальные free limits на момент проверки 2026-07-28: 10 баз, 500 МБ на базу,
5 ГБ суммарно, 5 млн прочитанных и 100 000 записанных строк в сутки.
