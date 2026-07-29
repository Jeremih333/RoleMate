# Матрица готовности RoleMate

Актуально на 29 июля 2026 года. Подробные доказательства, версии и ограничения
зафиксированы в `FINAL_VERIFICATION_REPORT.md`.

| Область                  | Статус                   | Проверка                                       |
| ------------------------ | ------------------------ | ---------------------------------------------- |
| Cloudflare App Worker    | Опубликован              | health/startup/ready 200                       |
| Закрытый D1 Worker API   | Опубликован              | ready 200, signed API                          |
| D1 production и preview  | Готово                   | миграции `0001`–`0018`, FK clean               |
| Telegram bot/webhook     | Реализовано и развёрнуто | интеграционные тесты                           |
| MiniApp                  | Реализовано и развёрнуто | 84 E2E на трёх viewport                        |
| Анкеты, поиск и рейтинг  | Готово                   | D1 integration + E2E                           |
| Медиа анкеты и чата      | Готово                   | Premium gates + regressions                    |
| Модерация и RBAC         | Готово                   | server + D1 + E2E                              |
| Stars, Premium и подарки | Готово                   | server + D1 integration                        |
| Промокоды                | Готово                   | резерв до оплаты, edit/delete, idempotency     |
| Рефералы                 | Готово                   | автоматическое начисление + HMAC anti-abuse    |
| Аудио/видеозвонки        | Ожидают credentials      | нужны Cloudflare Calls/TURN                    |
| Полная проверка          | Пройдена                 | lint, strict typecheck, 63 tests, build, audit |

## Внешние приёмочные действия

- Провести одну реальную тестовую оплату Stars и при необходимости возврат.
- Пройти relay двумя реальными Telegram-аккаунтами.
- Добавить Cloudflare Calls/TURN credentials для настоящих звонков.
- Передать реальные `custom_emoji_id`, если требуются именно платные emoji Telegram.
