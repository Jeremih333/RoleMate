# Testing

## Автоматические уровни

| Уровень    | Команда                         | Что проверяется                                |
| ---------- | ------------------------------- | ---------------------------------------------- |
| Static     | `corepack pnpm lint`            | ESLint, React hooks, запрещённые конструкции   |
| Types      | `corepack pnpm typecheck`       | строгий TypeScript во всех workspace           |
| Unit       | `corepack pnpm test`            | домен, HMAC, initData, контакты, платежи       |
| Migrations | `corepack pnpm test:migrations` | все SQL migrations в настоящем SQLite          |
| E2E        | `corepack pnpm test:e2e`        | API mocks и Mini App на Android/iPhone/desktop |
| Build      | `corepack pnpm build`           | production bundles                             |
| Worker     | `wrangler deploy --dry-run`     | Cloudflare Worker bundle                       |
| Security   | `toolkit/secret-scan.ps1`       | токены/ключи в отслеживаемых исходниках        |

`toolkit/verify.ps1` запускает локально применимую совокупность проверок.

## Ручные production smoke tests

После deploy обязательны: readiness D1, webhook status, `/start`, онбординг,
создание/редактирование анкеты, взаимный like, двусторонний text/media relay,
reply chain, block/report, native CAPTCHA, Turnstile, Stars invoice/precheckout/
successful_payment, возврат тестовой покупки, реферальная квалификация ровно один
раз, admin deny для обычного пользователя и admin dashboard для владельца.

Результаты с URL, commit SHA, временем и известными ограничениями фиксируются в
`FINAL_VERIFICATION_REPORT.md`. Непроведённая внешняя проверка не считается
успешной.
