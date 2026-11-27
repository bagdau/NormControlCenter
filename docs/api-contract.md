# Контракт API текущего среза

Все защищённые маршруты принимают `Authorization: Bearer <token>`. Ошибки возвращают JSON `{error, code?}`; 401 — сессия, 403 — запрет, 409 — конфликт версии/ключа. Тела и ответы на синтетических данных.

| Действие | Маршрут | Роль и правило |
|---|---|---|
| Вход/выход | `POST /api/auth/login`, `POST /api/auth/logout` | Активный аккаунт |
| Задания | `GET /api/assignments`, `POST /api/assignments` | Студент своей группы; преподаватель своих заданий |
| Сдача | `POST /api/assignments/:id/submit` | Студент группы задания; multipart `file` или JSON `snapshot`, обязателен `idempotencyKey` |
| Свои сдачи | `GET /api/submissions/mine` | Только студент |
| Очередь | `GET /api/submissions/queue` | Только преподаватель задания при активном назначении |
| Версия | `GET /api/submissions/:id/versions/:versionId/download` | Владелец-студент или преподаватель задания |
| Замечания | `POST /api/submissions/:id/remarks/draft`, `POST /api/submissions/:id/return` | Преподаватель задания |
| Ответ и пересдача | `POST /api/assignments/:id/submit` с `replies` | Только после опубликованного возврата |
| Согласование | `POST /api/remarks/:id/close`, `POST /api/submissions/:id/approve` | Преподаватель задания; обязательные пункты закрыты |

Успешная сдача возвращает `{bundle, receipt, deduplicated}`. Квитанция содержит `id`, `receiptNumber`, `submissionId`, `versionId`, `versionNum`, `sha256Hex`, `issuedAt`. Повтор того же ключа и байтов возвращает ту же квитанцию; другой хеш с тем же ключом — HTTP 409 `IDEMPOTENCY_CONFLICT`. Параллельная первая сдача сериализуется в PostgreSQL. Источник истины для статуса и доступа — сервер.
