# Финальный отчёт проверки RoleMate

Дата: 29 июля 2026 года.

## Production

- App Worker: `https://rolemate-app.carreljeremih.workers.dev`
- App Worker version: `601d300d-7d6c-4c78-8053-337c07b819d7`
- Data API: `https://rolemate-data-api.carreljeremih.workers.dev`
- Data API version: `002025fb-4b0a-42fe-bd76-235a88dc125f`
- Preview Data API version: `b50a221a-052d-466e-a4f1-3f8ede0eb1b3`
- D1 migrations: `0001`–`0010` применены к preview и production.
- Production остаётся единым Cloudflare App Worker с D1 и не требует Northflank или банковской карты.

## Реализовано в этом выпуске

- публикации через бота вне MiniApp: создание, лента, удаление, жалобы, блокировка и переход к общению;
- оценки собеседников, публичные лайки/дизлайки и влияние рейтинга на порядок анкет и публикаций;
- автоматическая публикация корректных анкет и модераторская блокировка по жалобе, Telegram ID или списку;
- Premium-ограничения для видео, GIF, аудио, ссылок и скрытия возраста/пола;
- проверка Premium-ссылок: разрешены проверяемые Telegram-профили и каналы, боты и группы отклоняются;
- единые подсказки о покупке Premium в боте и MiniApp;
- промокоды владельца: скидка в Stars, резерв рублёвой скидки для будущего внешнего метода, тарифы, Premium-дни, срок и лимит активаций;
- обязательная подписка в ленте после трёх публикаций, повтор через сутки, проверка каналов/супергрупп и кооперативная проверка сторонних ботов;
- новостной канал `https://t.me/rolemate`;
- назначение и отзыв модераторов владельцем по Telegram ID;
- отдельный RBAC модератора: пользователи, анкеты, медиа и жалобы доступны; платежи, Premium-выдача, цены, промокоды, рассылки, реклама, настройки, система и аудит закрыты сервером и интерфейсом;
- исправлен запуск из `/menu`: подписанный `tgWebAppData` восстанавливается из Telegram URL, если WebApp SDK загрузился поздно.

## Автоматическая проверка

| Проверка                         | Результат                                       |
| -------------------------------- | ----------------------------------------------- |
| Secret scan                      | passed                                          |
| Prettier                         | passed                                          |
| ESLint                           | passed                                          |
| TypeScript strict typecheck      | passed                                          |
| Unit/integration/migration tests | 47 passed                                       |
| Playwright E2E                   | 33/33 passed на small Android, iPhone и desktop |
| Production build                 | passed                                          |
| Dependency audit                 | известных уязвимостей нет                       |
| Preview migration + Worker smoke | passed, `ready`                                 |

Regression-тесты отдельно проверяют промокоды и лимиты, обязательную подписку после трёх постов, snooze/verify, назначение/отзыв модератора, запрет владельческих операций для модератора и позднюю загрузку Telegram SDK из `/menu`.

## Production smoke

| Проверка                      | Результат                       |
| ----------------------------- | ------------------------------- |
| App `/health/live`            | 200, `ok`                       |
| App `/health/startup`         | 200, `started`                  |
| App `/health/ready`           | 200, D1 `true`                  |
| App `/version`                | 200                             |
| Data API `/health/ready`      | 200, `ready`                    |
| Production MiniApp asset      | `assets/index-aFBXY-Dd.js`, 200 |
| Admin API без сессии          | 401                             |
| D1 migration list             | нет ожидающих миграций          |
| D1 `PRAGMA foreign_key_check` | нарушений нет                   |

## Честно оставшиеся внешние проверки

1. После исправления `/menu` нужен один повторный ручной клик владельца в реальном Telegram-клиенте. Автоматический сценарий с тем же Telegram launch fragment проходит.
2. Реальную Stars-покупку/возврат и двусторонний relay нельзя безопасно завершить без действий двух реальных пользователей и фактического платежа.
3. Telegram Bot API проверяет членство в канале/супергруппе через `getChatMember`, если RoleMate — администратор. Членство в стороннем боте Bot API не раскрывает, поэтому для ботов реализован подписанный callback с одноразово показываемым секретом.
4. Рублёвая скидка хранится для будущего внешнего метода, но не применяется к цифровому Premium внутри Telegram: там разрешены только Stars (`XTR`).
5. Для настоящих Telegram Premium custom emoji нужны реальные `custom_emoji_id`; пока используется безопасный Unicode fallback.
6. `.github/workflows/ci.yml` не изменялся, так как для этого требуется отдельная команда «Исправляй CI».
