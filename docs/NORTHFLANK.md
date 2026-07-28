# Northflank (устаревший необязательный fallback)

Production RoleMate перенесён на Cloudflare Workers, поэтому Northflank, карта и
постоянный контейнер больше не требуются. Инструкция ниже сохранена только как
исторический Docker fallback и не является частью актуального deploy.

Создайте Combined Service из Git-репозитория и выберите корневой `Dockerfile`.

Настройки:

- public port: `3000`, protocol HTTP;
- startup probe: `GET /health/startup`, initial delay 5 s, timeout 5 s;
- readiness probe: `GET /health/ready`, interval 15 s, timeout 5 s;
- liveness probe: `GET /health/live`, interval 30 s, timeout 5 s;
- minimum instances: 1;
- shutdown grace period: не менее 20 s.

Runtime variables берутся из `.env.example`. Секретами в Northflank должны быть
как минимум `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`INTERNAL_API_SECRET`, `SESSION_SECRET` и `TURNSTILE_SECRET_KEY`.

После первого успешного deployment выполните локально:

```powershell
$env:PUBLIC_BASE_URL='https://<service>.northflank.app'
$env:MINI_APP_URL=$env:PUBLIC_BASE_URL
corepack pnpm tsx scripts/setup-telegram.ts
corepack pnpm tsx scripts/check-webhook.ts
```

Deploy разрешён только после зелёных CI checks. Rollback выполняется переключением
Northflank на предыдущий проверенный image/commit; миграции D1 откатываются через
Time Travel по инструкции `migrations/ROLLBACK.md`.
