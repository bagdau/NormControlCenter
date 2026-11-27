# Контракт API текущего среза

Защищённые маршруты используют сессионную HttpOnly cookie `ncc_session`. `POST /api/auth/login` возвращает `csrfToken`; передавайте его в `X-CSRF-Token` для PUT/POST/PATCH/DELETE. `GET /api/auth/me` восстанавливает сессию и CSRF-токен после обновления страницы. Ошибки возвращают JSON `{error, code?}`; 401 — сессия, 403 — запрет, 409 — конфликт версии/ключа. Bearer-доступ в продукционном режиме выключен.

| Действие | Маршрут | Роль и правило |
|---|---|---|
| Вход/выход | `POST /api/auth/login`, `POST /api/auth/logout` | Активный аккаунт |
| Смена пароля | `POST /api/auth/change-password` | Текущий и новый пароль, затем завершение всех сессий |
| Задания | `GET /api/assignments`, `POST /api/assignments` | Студент своей группы; преподаватель своих заданий |
| Черновик | `GET/PUT/DELETE /api/assignments/:id/draft` | Только студент группы задания; снимок формы, ответы и ключ сдачи хранятся в PostgreSQL |
| Сдача | `POST /api/assignments/:id/submit` | Студент группы задания; multipart `file` или JSON `snapshot`, обязателен `idempotencyKey` |
| Свои сдачи | `GET /api/submissions/mine` | Только студент |
| Очередь | `GET /api/submissions/queue` | Только преподаватель задания при активном назначении |
| Версия | `GET /api/submissions/:id/versions/:versionId/download` | Владелец-студент или преподаватель задания |
| Замечания | `POST /api/submissions/:id/remarks/draft`, `POST /api/submissions/:id/return` | Преподаватель задания |
| Ответ и пересдача | `POST /api/assignments/:id/submit` с `replies` | Только после опубликованного возврата |
| Согласование | `POST /api/remarks/:id/close`, `POST /api/submissions/:id/approve` | Преподаватель задания; обязательные пункты закрыты |

Успешная сдача возвращает `{bundle, receipt, deduplicated}`. Квитанция содержит `id`, `receiptNumber`, `submissionId`, `versionId`, `versionNum`, `sha256Hex`, `issuedAt`. Повтор того же ключа и байтов возвращает ту же квитанцию; другой хеш с тем же ключом — HTTP 409 `IDEMPOTENCY_CONFLICT`. Параллельная первая сдача сериализуется в PostgreSQL. Источник истины для статуса и доступа — сервер.
