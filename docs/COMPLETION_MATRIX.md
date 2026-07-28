# Матрица готовности RoleMate

Дата аудита: 28 июля 2026 года.

Статусы:

- **Подтверждено** — есть проверяемое локальное или production-доказательство.
- **Реализовано, ждёт production-проверки** — код и автоматические тесты готовы, но
  внешний сценарий ещё нельзя считать проверенным.
- **Заблокировано** — требуется действие вне репозитория.
- **Финальный проход** — выполняется только после production deploy.

Этот документ является рабочей матрицей. Он не заменяет
`FINAL_VERIFICATION_REPORT.md`, который создаётся после полного production
прогона.

## Definition of Done

| Требование                                 | Статус                                | Авторитетное доказательство / следующий gate                                                                                                                            |
| ------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram-бот работает                      | Реализовано, ждёт production-проверки | grammY/Fastify; интеграционный тест реального webhook-контура проверяет инициализацию, `/start`, кнопки и оформление                                                    |
| Mini App работает                          | Реализовано, ждёт production-проверки | production Vite build и 18 Playwright-проверок на Android/iPhone/desktop                                                                                                |
| Production и preview D1 созданы            | Подтверждено                          | `rolemate-production` (`b43f7694-2383-43ed-9993-ea37af18ec71`) и `rolemate-preview` (`f67fcb4e-16ee-4154-b5d9-0ee897972dbd`)                                            |
| Миграции применены                         | Подтверждено                          | `0001`–`0007` применены к обеим D1; `PRAGMA foreign_key_check` пуст                                                                                                     |
| Data API Worker развёрнут                  | Подтверждено                          | `https://rolemate-data-api.carreljeremih.workers.dev`; signed HMAC smoke возвращает readiness и каталог продуктов                                                       |
| Основной сервис развёрнут на Northflank    | Заблокировано                         | Northflank отвечает `409`: аккаунту нужен default payment method; после добавления карты применяется `infrastructure/northflank/service.json`                           |
| Telegram webhook активен                   | Заблокировано                         | настраивается на HTTPS URL Northflank после успешного deploy                                                                                                            |
| Все кнопки работают                        | Реализовано, ждёт production-проверки | маршруты bot callbacks/commands и Mini App actions реализованы; финальный ручной button-by-button проход после webhook                                                  |
| Анкеты создаются и редактируются           | Подтверждено локально                 | полная Zod-схема, D1 integration и Playwright regression существующих значений                                                                                          |
| Поиск работает                             | Подтверждено локально                 | scoring/age/block/moderation/media gates, D1 integration и UI E2E                                                                                                       |
| Мэтчи создаются                            | Подтверждено локально                 | каноническая пара, взаимный like и создание conversation в integration suite                                                                                            |
| Анонимный relay не раскрывает отправителя  | Подтверждено локально                 | `copyMessage`/новое `sendMessage`, `protect_content`, пустые entities, mapping и security architecture tests; production media/text smoke ещё входит в финальный проход |
| Блокировки работают                        | Подтверждено локально                 | block закрывает conversation и запрещает дальнейшие profile/media/relay операции                                                                                        |
| Жалобы работают                            | Подтверждено локально                 | ограниченное evidence, очередь модерации и owner action покрыты integration suite                                                                                       |
| Premium entitlements работают              | Подтверждено локально                 | extension/revoke/status, лимиты и все заявленные Premium gates покрыты unit/integration                                                                                 |
| Stars payment flow проверен                | Реализовано, ждёт production-проверки | order/invoice/pre-checkout/success/idempotency покрыты тестами; реальная тестовая покупка выполняется после webhook                                                     |
| Возвраты реализованы                       | Реализовано, ждёт production-проверки | owner-only refund, корректировка entitlement и idempotency покрыты integration; Telegram refund smoke после deploy                                                      |
| Referral начисляет ровно 24 часа один раз  | Подтверждено локально                 | qualification + unique grant + duplicate update integration regression                                                                                                  |
| CAPTCHA срабатывает по risk score          | Подтверждено локально                 | native challenge и Turnstile API gates, attempts/expiry/replay/risk operations                                                                                          |
| Mini App проверяет initData                | Подтверждено локально                 | официальный HMAC-порядок, auth_date TTL и изменённая подпись в security tests                                                                                           |
| Admin доступен только `1040929628`         | Подтверждено локально                 | UI visibility + серверная проверка Telegram ID и persisted admin role                                                                                                   |
| Обычный пользователь не вызывает admin API | Подтверждено локально                 | 403, risk signal и отсутствие admin route в E2E                                                                                                                         |
| Изображения оформлены                      | Подтверждено                          | avatar, hero и social card находятся в `assets/generated`; welcome photo подключено к `/start`                                                                          |
| Ссылка поддержки указана                   | Подтверждено                          | централизованная конфигурация и тексты ведут на `@odinnadsat`                                                                                                           |
| Подпись пиар-чата добавлена                | Подтверждено                          | централизованные full/short footers и подпись Mini App; исключена из пользовательского relay                                                                            |
| Production Docker image собирается         | Реализовано, ждёт проверки            | Dockerfile подготовлен, но Docker CLI на текущем Windows-host отсутствует; чистый GitHub Docker gate ждёт разрешённого CI-исправления                                   |
| Health checks проходят                     | Подтверждено частично                 | Worker production readiness проходит; `/health/live`, `/health/startup`, `/health/ready` основного сервиса проверяются после Northflank                                 |
| Автотесты проходят                         | Подтверждено локально                 | 36 unit/integration/migration и 18 E2E прошли; новый webhook regression увеличивает bot-api suite с 1 до 4 тестов                                                       |
| Security checks проходят                   | Подтверждено локально                 | secret scan, auth/HMAC/replay/admin/contact/privacy checks и dependency audit без известных high/critical                                                               |
| Полный README создан                       | Подтверждено                          | архитектура, env, D1, Worker, Northflank, webhook, Mini App, Stars, referrals, CAPTCHA, admin, tests и troubleshooting                                                  |
| Финальный verification report создан       | Финальный проход                      | создаётся только с фактическими Northflank URL, webhook status, health, Docker/CI и ручной regression evidence                                                          |

## Незакрытые внешние gates

1. Добавить default payment method в
   [Northflank Billing](https://app.northflank.com/s/account/billing).
2. Дать явное разрешение исправить порядок clean-runner CI: перед `lint` собрать
   `@rolemate/shared`. Без разрешения workflow не изменяется.
3. После Northflank deploy настроить Telegram webhook и Mini App URL, затем
   пройти Stars/refund и ручную production-регрессию.
4. Отправить выбранные Telegram Premium-эмодзи боту, получить реальные
   `custom_emoji_id` и заполнить `TELEGRAM_CUSTOM_EMOJI_IDS`.
