# Архитектура RoleMate

Production RoleMate состоит из двух Cloudflare Worker и общих TypeScript-пакетов.

```text
Telegram / Mini App
        │
        ▼
apps/bot-api — Cloudflare App Worker
        │  ├─ Worker-native HTTP: webhook и Mini App API
        │  ├─ grammY: команды, relay и Telegram Stars
        │  ├─ Static Assets: собранный Mini App и изображения
        │  └─ Cron Trigger: очередь рассылок
        │
        │  Service Binding + HMAC-SHA256 + timestamp + nonce
        ▼
apps/d1-worker — Cloudflare Data API Worker
        │  prepared statements
        ▼
Cloudflare D1
```

App Worker является доверенной границей Telegram: проверяет webhook secret,
Mini App `initData`, CSRF, права администратора, платёжные события, лимит тела и
rate limits. Он работает на бесплатном Workers runtime без постоянно
запущенного контейнера, sleep/cold-start хостинга и банковской карты.

Fastify-сборка сохранена как локальный и Docker fallback. В production Wrangler
подменяет несовместимый Fastify runtime на Worker-native Web Standards adapter.
Он повторно использует те же обработчики маршрутов, поэтому Node и Worker не
расходятся по бизнес-логике, но production не использует запрещённый `eval`.

Data API Worker не принимает произвольный SQL: доступны только
версионированные операции домена с Zod-валидацией и prepared statements.
Одноразовые nonce хранятся в D1 и закрывают replay. Service Binding сохраняет
внутренний вызов внутри сети Cloudflare; HMAC остаётся дополнительной границей.

Анонимный чат никогда не использует Telegram forward. Backend создаёт новое
сообщение или безопасно копирует разрешённое медиа, удаляя исходную клавиатуру и
не добавляя сведения об отправителе. Текст сообщений не хранится постоянно;
сохраняется только техническое сопоставление для reply и явно выбранный
moderation snapshot при жалобе.

Единственный активный provider цифрового Premium — Telegram Stars (`XTR`).
YooKassa выключена и оставлена лишь как адаптер для допустимых будущих внешних
сценариев.

Административные рассылки проходят через `broadcasts`,
`broadcast_deliveries` и `background_jobs`. После обязательного dry run и
контрольной фразы Cron Trigger раз в минуту запускает dispatcher. Он соблюдает
лимит до 30 адресатов в секунду, фиксирует доставку и поддерживает паузу/отмену.

Служебные сообщения оформляются Telegram entities без изменения relay-контента.
Приветствие отправляется с фирменным изображением. Premium custom emoji
включаются только через проверенные `custom_emoji_id`; без них используется
Unicode fallback.
