# НормКонтрольЦентр

Система сдачи учебных работ и нормоконтроля: студент отправляет PDF/DOCX или формирует отчёт, получает квитанцию; преподаватель публикует замечания, принимает исправленную версию и фиксирует внутреннее согласование. Данные хранятся в PostgreSQL, файлы — в приватном Docker-томе. Официальные оценки, ЭЦП и интеграция с LMS не реализованы.

## Развертывание на сервере

Инструкция для Linux-сервера с Docker Compose, доменом и HTTPS: [docs/deployment.md](docs/deployment.md). Для переноса данных: [docs/operations.md](docs/operations.md).

Кратко: задайте `POSTGRES_PASSWORD`, `SESSION_SECRET`, `DOMAIN` в `.env`, затем выполните:

```sh
docker compose -f docker-compose.yml -f compose.production.yml up --build -d --wait
read -rsp 'Initial admin password: ' ADMIN_PASS; echo
printf '%s' "$ADMIN_PASS" | docker compose -f docker-compose.yml -f compose.production.yml exec -T app bun db/bootstrap-admin.ts admin@example.org 'Administrator Name'
unset ADMIN_PASS
```

Пароль первого администратора должен содержать 16–256 символов. Команда bootstrap работает только при пустой таблице пользователей. В административном интерфейсе затем создаются факультеты, кафедры, группы, преподаватели, студенты и назначения.

## Проверка разработки

```powershell
npx --yes bun install --frozen-lockfile
npx --yes bun run lint
npx --yes bun test
npx --yes bun run build
```

Для локального PostgreSQL задайте секреты в `.env`, `APP_PORT=3001`, затем `docker compose up --build -d --wait`. Синтетический набор данных загружается только явным запуском:

```powershell
docker compose exec -T -e ALLOW_SYNTHETIC_SEED=true app bun db/seed.ts
$env:SMOKE_BASE_URL='http://localhost:3001'
node tests/postgres-smoke.mjs
```

Тестовые учётные записи после seed: `smailov@normocontrol.local`, `omarova@normocontrol.local`, `admin@normocontrol.local`; пароль `DemoNormo2024!`. Эти учётные записи нельзя загружать на рабочий сервер.

Локальный просмотр без БД: `npx --yes bun run dev` при `DEMO_MODE=true`; данные хранятся только в памяти и исчезают при перезапуске.

## Статус

Сборка, 11 автоматических тестов, сценарий с PostgreSQL, чистый запуск и перенос через резервную копию проверены локально. Реальное доменное HTTPS-развертывание и эксплуатационная приёмка в инфраструктуре заказчика требуют отдельной проверки на его сервере. Известные ограничения описаны в [docs/qa-report.md](docs/qa-report.md).
