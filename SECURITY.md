# Security

## Модель доверия

Браузер, Telegram update и все пользовательские поля считаются недоверенными.
Mini App авторизуется только после server-side проверки HMAC `initData` и
свежести `auth_date`. Сессия хранится в HttpOnly Secure SameSite cookie, мутации
требуют CSRF token. Admin ID извлекается только из серверной сессии.

D1 не доступна основному сервису напрямую. Worker принимает только Zod-описанные
операции и prepared statements. Каждый запрос подписывается HMAC с service ID,
timestamp и одноразовым nonce. Произвольный SQL по HTTP отсутствует.

Relay запрещает контакты в тексте/подписях, применяет rate limit и не использует
forward. Полные тексты сообщений в D1 не сохраняются; хранится только техническое
соответствие message ID для ответов и модерации.

Логи редактируют cookie, authorization, initData и CAPTCHA token. Секреты должны
находиться только в secret stores Cloudflare/Northflank.

## Сообщение об уязвимости

Не публикуйте уязвимость в открытом чате. Напишите владельцу:
[@odinnadsat](https://t.me/odinnadsat), приложив минимальные шаги воспроизведения
без реальных персональных данных.

## Эксплуатационный минимум

- регулярно ротировать webhook, session и internal HMAC secrets;
- включить branch protection и обязательный CI;
- сначала проверять миграции в preview D1;
- отслеживать 401/403/429, risk events и dead-letter jobs;
- немедленно отозвать скомпрометированный bot token через BotFather;
- не включать YooKassa для Telegram digital goods без отдельной проверки.
