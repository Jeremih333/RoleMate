# Восстановление миграций

D1 migrations считаются прямыми и неизменяемыми. Откат production не выполняется
удалением таблиц. Перед применением создаётся Time Travel bookmark/backup, миграция
сначала применяется к `rolemate-preview`, затем выполняются migration и smoke tests.

Если миграция нарушила работу:

1. остановить запись через `maintenance_mode`;
2. восстановить базу через D1 Time Travel в новую production-базу;
3. переключить binding Worker на восстановленную базу;
4. проверить readiness и контрольные запросы;
5. возобновить трафик;
6. оформить исправляющую миграцию с новым последовательным номером.

Файлы уже применённых миграций не редактируются.

## Миграция 0041

Перед production-применением сохранить D1 Time Travel bookmark. Миграция
копирует ошибочно связанные с анкетами аудио профиля в таблицу
`migration_0041_profile_audio_questionnaire_backup`, а затем удаляет только эти
копии из `questionnaire_media`. Для точечного восстановления выполнить
`INSERT OR IGNORE INTO questionnaire_media SELECT * FROM
migration_0041_profile_audio_questionnaire_backup`. Для полного восстановления
использовать сохранённый Time Travel bookmark по общей процедуре выше.

## Миграция 0025

Перед применением сохранить свежий D1 Time Travel bookmark. Миграция добавляет к
`telegram_posts` только заголовок и Markdown-текст, копирует в Markdown-текст
существующий `text_preview` и создаёт таблицу короткоживущих сессий редактирования
медиа. Посты и медиа не удаляются. При откате сначала вернуть предыдущие версии
Workers; таблицу сессий можно удалить, а новые столбцы безопасно оставить
неиспользуемыми. Полный физический откат выполняется только через Time Travel.

## Миграция 0024

Перед применением сохранить свежий D1 Time Travel bookmark. Миграция только
добавляет таблицу `profile_usernames` и два индекса; существующие пользователи,
профили, анкеты, симпатии, медиа и посты не изменяются. До начала использования
таблицу можно удалить после отката Workers. После начала использования сначала
экспортировать соответствие псевдонимов и профилей; production-откат выполнять
через предыдущие версии Workers и D1 Time Travel bookmark.

## Миграция 0023

Перед применением сохранить свежий D1 Time Travel bookmark. Миграция добавляет
к `user_profiles` только статус модерации, причину и индекс; профили, анкеты,
посты, комментарии, медиа, рейтинги и audit log не удаляются. При регрессии
сначала откатить App Worker и Data API Worker на предыдущие версии, затем
восстановить D1 из bookmark по общей процедуре выше.

## Миграция 0011

Перед 0011 обязательно сохранить D1 Time Travel bookmark. Миграция пересоздаёт
`profile_media`, предварительно копируя все строки в новую таблицу с расширенным
набором типов. После preview-проверки нужно сравнить количество строк до и после.
При несовпадении production-миграция не запускается. Восстановление выполняется
из bookmark в новую базу с последующим переключением Worker binding по общей
процедуре выше.

## Миграция 0013

Перед применением проверить отсутствие более одного незавершённого или оплаченного
заказа на одну пару `user_id + promotion_id`. Миграция добавляет только уникальный
частичный индекс и не удаляет данные. Если preview-проверка обнаруживает дубликаты,
production-миграция не запускается: сначала заказы разбираются вручную без изменения
истории платежей. Восстановление выполняется через D1 Time Travel по общей процедуре.

## Миграция 0014

Миграция добавляет к заказу необязательного получателя Premium-подарка и индекс для
поиска таких заказов. Существующие заказы получают `NULL`, данные не удаляются и не
переписываются. Перед production-применением миграция проверяется на preview, затем
выполняются `PRAGMA foreign_key_check` и контроль структуры `payment_orders`.
Восстановление выполняется через D1 Time Travel по общей процедуре.

## Миграция 0016

Миграция переводит только ожидающие проверки медиафайлы анкет в опубликованный статус.
Отклонённые файлы и история модерации не изменяются, строки не удаляются. Перед применением
фиксируются количества `pending`, `approved` и `rejected`; после применения `pending` должно
стать равно нулю, а сумма строк — остаться неизменной. Если потребуется вернуть прежний статус
конкретным файлам, используется сохранённый D1 Time Travel bookmark либо новая адресная
исправляющая миграция — применённый файл 0016 не редактируется.

## Миграция 0017

Миграция меняет конфигурацию бесплатного boost с прежнего периода на один день. Перед
применением сохраняется текущее значение `boost_cooldown_days`. Строки пользователей и анкет
не изменяются. Для возврата прежнего периода создаётся новая последовательная миграция либо
восстанавливается сохранённое значение конфигурации после проверки на preview.

## Миграция 0018

Миграция создаёт отдельный anti-abuse ledger с HMAC-отпечатками Telegram identity. Исходные
Telegram ID в таблице не хранятся. Ledger не связан внешним ключом с пользовательскими данными,
поэтому удаление и повторная регистрация не позволяют повторно получить реферальную награду.
Миграция не изменяет существующие строки: отпечатки старых пользователей безопасно
дозаполняются при следующем входе, квалификации или удалении аккаунта. Откат выполняется через
D1 Time Travel; удалять ledger без отдельного плана нельзя, поскольку это ослабит защиту.

## Миграция 0015

Миграция добавляет отметку безопасного удаления промокода и снимки условий скидки
в активации. Для существующих скидочных активаций снимки заполняются из текущих
настроек промокодов; строки не удаляются. Перед production-применением сравниваются
число скидочных активаций и число заполненных снимков на preview. После применения
выполняются `PRAGMA foreign_key_check` и тест оплаты ранее активированной скидки.
Восстановление выполняется через D1 Time Travel по общей процедуре.

## Миграция 0019

Миграция добавляет к `profile_media` только необязательные метаданные музыкального
трека: название, исполнителя и Telegram file ID обложки. Существующие строки получают
`NULL`, медиафайлы и их порядок не изменяются. Перед применением сохраняется D1 Time
Travel bookmark; откат выполняется восстановлением из bookmark либо новой
последовательной миграцией с пересозданием таблицы после резервного копирования.

## Миграция 0020

Миграция добавляет к `matches` источник связи (`mutual` или `direct`). Все
существующие строки получают безопасное значение `mutual`; пользовательские данные не
удаляются. Перед применением сохраняется D1 Time Travel bookmark. Откат выполняется
через bookmark либо новой последовательной миграцией с пересозданием `matches` после
резервного копирования связанных `conversations`.

## Миграция 0022

Миграция не изменяет и не удаляет `profiles` или `profile_media`: существующие
профили, анкеты и медиа копируются с сохранением ID. До переключения приложения
откат состоит в удалении только шести новых таблиц в обратном порядке
зависимостей. После переключения сначала экспортируются новые анкеты,
комментарии и оценки, возвращается предыдущая версия приложения, и только затем
удаляются таблицы совместимости. Для production обязательны D1 Time Travel
bookmark и успешная проверка миграции на preview.

## Миграция 0021

Миграция добавляет к профилю ссылку на аватар по внутреннему `user_id` и
необязательные технические метаданные медиа. Строки и файлы не удаляются.
Перед production сохраняется D1 Time Travel bookmark. Старый код безопасно
игнорирует новые столбцы; для физического удаления столбцов потребуется
восстановление из bookmark либо новая миграция с пересозданием таблиц после
экспорта и сверки количества профилей и медиа.

## Миграция 0026

Миграция только добавляет таблицу независимых оценок публичных профилей и индекс.
Существующие пользователи, анкеты, посты и их рейтинги не изменяются. Перед production
сохраняется D1 Time Travel bookmark. Для отмены после публикации используется восстановление
по bookmark; удалять таблицу отдельной миграцией можно только после экспорта и сверки оценок.

## Миграция 0027

Миграция добавляет таблицу элементов медиакарусели и копирует в неё существующие одиночные
медиа постов. Исходные столбцы `telegram_posts` не очищаются и остаются совместимым fallback.
Перед production сохраняется D1 Time Travel bookmark; откат выполняется восстановлением по
bookmark. До удаления новой таблицы требуется экспорт и сверка количества перенесённых медиа.

## Миграция 0028

Миграция добавляет центр уведомлений и два включённых по умолчанию переключателя Telegram-
доставки. Существующие настройки и данные не переписываются. Перед production сохраняется
D1 Time Travel bookmark; откат выполняется по bookmark. Удаление таблицы без экспорта истории
уведомлений и сверки количества непрочитанных записей запрещено.

## Миграция 0029

Миграция добавляет необязательную связь ответа с родительским комментарием и отдельную таблицу
оценок комментариев. Существующие комментарии остаются корневыми, их текст и порядок не
изменяются. Перед production сохраняется D1 Time Travel bookmark; откат выполняется по bookmark.

## Миграция 0030

Миграция добавляет постам структурированные теги, фандомы, хештеги и состояние охвата.
Существующие посты получают пустые наборы и нормальный охват, публикации не удаляются и не
скрываются. Перед production сохраняется D1 Time Travel bookmark; откат выполняется по bookmark.

## 0031_contextual_reports_and_swipe_targets.sql

SQLite не удаляет добавленные столбцы безопасно без пересоздания таблиц. Для отката
сначала сохраните bookmark D1, затем восстановите базу на него. Индексы
`idx_reports_questionnaire`, `idx_reports_comment` и `idx_swipes_questionnaire`
можно удалить отдельно без потери данных.

## Миграция 0032

Миграция добавляет подписки, блокировки и настройки приватности публичного профиля без
удаления существующих данных. Перед production сохраняется D1 Time Travel bookmark.
Откат выполняется восстановлением по bookmark; перед физическим удалением таблиц подписок
и блокировок нужен экспорт связей и сверка количества строк.

## Миграция 0033

Миграция добавляет защищённую историю сообщений и флаг локального скрытия чата. До
production сохраняется bookmark. Удалять таблицу истории нельзя без зашифрованного экспорта
и плана восстановления; штатный откат выполняется только через D1 Time Travel.

## Миграция 0034

Миграция добавляет включённый по умолчанию переключатель Telegram-доставки уведомлений.
Пользовательские настройки не сбрасываются. Откат выполняется по предварительному bookmark
либо следующей последовательной миграцией после экспорта `user_settings`.

## Миграция 0035

Миграция создаёт упорядоченную медиакарусель аватара и копирует в неё существующий основной
аватар без изменения `avatar_media_id`. Перед production сохраняется bookmark и сверяются
число непустых старых аватаров и число перенесённых первых элементов. Откат — восстановление
по bookmark; таблицу нельзя удалять после начала использования без экспорта порядка медиа.

## Миграция 0036

Миграция добавляет бесплатные настройки видимости разделов, аудитории личных сообщений и
последней активности с безопасными публичными значениями по умолчанию. Данные не удаляются.
Откат выполняется по bookmark либо новой миграцией после экспорта настроек профилей.

## Миграция 0037

Миграция добавляет отметки доставки/прочтения и присутствия в чате. Старые сообщения
получают `delivered_at = created_at`, их содержимое не меняется. Перед production сохраняется
bookmark; для отката используется D1 Time Travel, поскольку удаление столбцов потребовало бы
пересоздания таблиц истории.

## Миграция 0038

Миграция пересоздаёт только таблицу юзернеймов ради нового `CHECK`, разрешающего владельцу
полностью кириллические адреса. Все строки, владельцы, основные флаги и временные метки
копируются до удаления временной ASCII-таблицы. Перед preview и production обязательны D1
Time Travel bookmark и сверка количества/набора юзернеймов до и после. Откат выполняется
восстановлением bookmark; обратная ASCII-миграция без предварительного переноса кириллических
адресов запрещена.

## Миграция 0039

Миграция только добавляет к `processed_telegram_updates` состояние обработки,
уникальный токен аренды, срок аренды и время завершения. Существующие строки
сохраняются и помечаются завершёнными; пользовательские данные не удаляются.
Перед production сохраняется D1 Time Travel bookmark. Откат выполняется
возвратом приложения к предыдущей версии и восстановлением по bookmark либо
следующей последовательной миграцией после экспорта таблицы; удалять столбцы
через пересоздание таблицы без экспорта и сверки `update_id` запрещено.

# Миграция 0040 — чат и уведомления

Миграция добавляет мягкое скрытие уведомлений, идентификатор медиагруппы и таблицу реакций.
Существующие уведомления и сообщения не изменяются и не удаляются. Перед production сохраняется
D1 Time Travel bookmark. Откат выполняется восстановлением по bookmark; удалять таблицу реакций
или новые столбцы без экспорта и сверки количества строк запрещено.

# 0042 — контекст загрузки медиа без ForceReply

Перед откатом остановить приём новых Telegram update. Таблица хранит только временный маршрут
следующего медиафайла (не сами медиа и не пользовательский текст), поэтому резервная копия данных
не требуется. Для отката удалить `idx_media_upload_intents_expiry`, затем
`media_upload_intents`, и вернуть обработчик на предыдущую версию. Уже опубликованные медиа не
затрагиваются.

# 0044_chat_organization.sql

Перед откатом сохраните `conversation_participants` и `user_settings` через D1 Time Travel bookmark.
SQLite не удаляет добавленные колонки без пересоздания таблиц, поэтому безопасный откат приложения —
вернуть Worker на предыдущую версию, оставив совместимые nullable/default-поля. Полный откат схемы
выполняется только восстановлением D1 из bookmark, сделанного непосредственно перед миграцией.

# 0045_expand_chat_reactions.sql

Перед применением создаётся D1 Time Travel bookmark. Миграция сначала копирует все реакции в
новую таблицу и только затем заменяет старую; количество строк проверяется до продолжения
публикации. Откат старого ограничения из пяти реакций выполняется восстановлением bookmark после
экспорта новых Unicode-реакций — удалять их обратной миграцией без экспорта запрещено.

# 0046_follower_content_notifications.sql

Перед применением создаётся D1 Time Travel bookmark и сверяется количество уведомлений. Миграция
копирует все поля, включая `read_at` и `dismissed_at`, в таблицу с новым типом уведомления.
Обратный переход выполняется восстановлением bookmark после экспорта `followed_content` строк;
удаление этих уведомлений при откате без экспорта запрещено.

# 0047_chat_message_editing.sql

Restore the Time Travel bookmark captured before deployment. The migration only adds message edit
metadata and media ordering; no existing message bytes are rewritten.

# 0048_chat_replies_forwarding_privacy.sql

Before preview and production, create a D1 Time Travel bookmark. This migration only adds nullable
message relationship columns, one privacy flag with a safe default, and indexes; it does not rewrite
or delete message content. Roll back the application first and restore the bookmark if a schema
rollback is required. Do not rebuild `conversation_messages` to remove the columns without an
encrypted export and row-count verification.

# 0050_profile_audio_order.sql

Before preview and production, create a D1 Time Travel bookmark and export `profile_media`.
The migration adds a nullable `audio_sort_order` column, backfills only audio/voice rows, and adds
an index; it does not delete media or change Telegram file identifiers. Roll the application back
first. Restore the bookmark for a schema rollback, because SQLite cannot safely drop the column
without rebuilding the table. Do not rebuild it without the export and row-count verification.

# 0053_questionnaire_positive_reactions.sql

Перед production создаётся полный D1 export. Миграция не удаляет исторические `swipes`: она
создаёт канонический реестр и выбирает самую раннюю положительную реакцию каждой пары
«пользователь–анкета». При откате сначала вернуть Worker на предыдущую версию. Таблицу можно
удалять только после экспорта её строк; для полного отката предпочтительно восстановить сделанную
перед миграцией копию.

# 0054_conversation_live_activity.sql

Перед production создаётся полный D1 export. Миграция добавляет два nullable-поля краткоживущего
статуса и индекс, существующие чаты и сообщения не переписываются. Предпочтительный откат — вернуть
Worker и восстановить резервную копию. Не пересоздавать `conversation_participants` ради удаления
полей без экспорта и сверки всех участников диалогов.

# 0055_taxonomy_suggestion_buffer.sql

This migration creates an aggregate suggestion table and backfills only taxonomy values from
questionnaires and active posts. It does not copy profile prose or delete source data. Roll the
application back first. The table may then be dropped after exporting it, or the pre-migration D1
bookmark may be restored if an exact schema rollback is required.

# 0056_profile_media_upload_kinds.sql

This migration adds `media_kind` with the backward-compatible default `any` to the temporary
`media_upload_intents` table. A previous Worker can safely run while the column remains present.
Prefer rolling back only the application; do not rebuild the table merely to remove this column.
Use the pre-migration D1 bookmark only when an exact schema rollback is mandatory.

# 0057_profile_music_and_onboarding_reminders.sql

Перед production создаётся полный D1 export. Миграция добавляет nullable-маркер настройки
публичного профиля, восстанавливает отсутствующие строки настроек с безопасными значениями по
умолчанию и создаёт таблицу расписания редких onboarding-напоминаний. Пользовательский контент не
удаляется. Для отката сначала вернуть предыдущие версии Workers; таблицу расписания можно удалить
только после экспорта, а столбец `configured_at` следует оставить как обратно совместимый. Для
точного отката схемы восстановить предмиграционную копию D1.

# 0058_engagement_reminder_campaigns.sql

Перед production создаётся полный D1 export. Миграция только создаёт таблицу редкого расписания
новостных и реферальных напоминаний и инициализирует её внутренними идентификаторами пользователей;
контент, подписки и рефералы не изменяются. При откате сначала вернуть предыдущий App Worker, чтобы
он перестал выдавать новые claims. Затем таблицу можно удалить после экспорта либо восстановить
предмиграционную копию D1. Не удалять таблицу, пока существует активный Worker с операциями
`notifications.engagement.*`.

# Migration 0060

`0060_chat_drafts_message_pins_and_hidden_posts.sql` is additive. Before rollback, export D1 and retain the `conversation_drafts`, `conversation_message_pins`, `hidden_posts`, and `conversation_messages.caption_position` data. SQLite cannot remove the added `caption_position` column safely without rebuilding `conversation_messages`; restore the pre-migration backup for a full rollback. A logical rollback may drop the three new tables and their indexes after export while leaving the nullable column unused.

# Migration 0061

`0061_public_group_campaigns.sql` is additive and stores only public Telegram chat identifiers,
administrator consent state and delivery counters. Before production, create a D1 backup. For a
logical rollback, deploy the previous App Worker first so no new campaign claims are created, export
`public_group_campaigns`, and only then drop its index and table. Restore the pre-migration backup
when an exact schema rollback is required.

# 0062_safe_dynamic_questionnaire_suggestions.sql

- Перед production-применением создать D1 backup/export.
- Миграция переносит все допустимые подсказки в новую таблицу, удаляет небезопасные значения и сводит межсекционные дубли к одной записи.
- Для отката восстановить D1 из созданного backup. Схему старого CHECK нельзя безопасно вернуть без пересборки таблицы.

# 0063_taxonomy_suggestion_selections.sql

This migration adds per-user suggestion selections used only for aggregate ranking. Rollback is
safe and does not affect profiles, questionnaires, posts, or the suggestion catalogue itself:

```sql
DROP INDEX IF EXISTS idx_taxonomy_suggestion_selections_rank;
DROP TABLE IF EXISTS taxonomy_suggestion_selections;
```

# 0064_unicode_taxonomy_canonicalization.sql

This migration merges case-only Unicode duplicates while preserving the aggregate catalogue and
distinct per-user selections. Before applying it to production, retain the pre-0063/0064 D1
export. An exact rollback should restore that export. The logical rollback is to keep the
canonical tables: returning to case-sensitive duplicates would make popularity inaccurate.
