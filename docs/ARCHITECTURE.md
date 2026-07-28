# Архитектура RoleMate

RoleMate разделён на три исполняемых приложения и общие пакеты.

```text
Telegram / Mini App
        │
        ▼
apps/bot-api (Fastify + grammY)
        │  HMAC-SHA256, timestamp, nonce
        ▼
apps/d1-worker (Cloudflare Worker)
        │  prepared statements
        ▼
Cloudflare D1
```

`bot-api` является доверенной границей Telegram: проверяет webhook secret,
Mini App `initData`, права администратора, платежные события и rate limits.
Worker не принимает произвольный SQL, а предоставляет только версионированные
операции домена. Одноразовые nonce хранятся в D1 и закрывают replay.

Анонимный чат никогда не использует Telegram forward. Backend создаёт новое
сообщение или безопасно копирует разрешённое медиа, удаляя исходную клавиатуру и
не добавляя сведения об отправителе. Текст сообщений не хранится постоянно;
сохраняется только техническое сопоставление для reply и явно выбранный
moderation snapshot при жалобе.

Внешние платежи отключены для цифрового Premium внутри Telegram. Единственный
активный provider — Telegram Stars (`XTR`); YooKassa реализуется как отключённый
адаптер для допустимых будущих внешних сценариев.
