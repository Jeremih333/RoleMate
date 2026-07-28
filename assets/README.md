# Визуальные материалы

- `source/` содержит неизменённые оригиналы.
- `generated/` содержит оптимизированные производные версии.
- `scripts/generate-assets.ts` воспроизводимо создаёт WebP и карточку с подписью.

Оригинальный фон RoleMate создан встроенным генератором изображений по проектному
брифу: графитово-фиолетовая литературная сцена с двумя книгами и связующей нитью.
Он не содержит чужих логотипов, персонажей, текста или водяных знаков.

## Аватар Telegram-бота

- `generated/telegram-bot-avatar.png` — lossless-мастер, созданный из
  предоставленного пользователем готического изображения;
- `generated/telegram-bot-avatar.jpg` — подготовленный для Telegram Bot API
  файл 1024×1024.

Техническая подготовка JPG без изменения дизайна:

```powershell
node toolkit/prepare-telegram-avatar.mjs
```

Повторная настройка профиля без сохранения токена (переменная
`TELEGRAM_BOT_TOKEN` должна быть заранее задана безопасным способом):

```powershell
powershell -ExecutionPolicy Bypass -File toolkit/configure-telegram-profile.ps1
```
