# MAX-бот СОШ №20 на Cloudflare Workers

Production-вариант без VPS: Cloudflare Worker + D1 + MAX Webhook.

## Что умеет v0.2

- Webhook MAX с проверкой `X-Max-Bot-Api-Secret`;
- роли: учитель / ученик или родитель;
- выбор учителя из листа `Учителя`;
- выбор класса 5–11 из листа `Расписание`;
- кнопки Сегодня / Завтра / Изменения / Оповещения / Профиль;
- расписание читается из тех же Google Sheets, что сайт школы;
- учитель видит опубликованную сетку `Учителя_сайт`;
- ученик видит `Расписание` + лист `Изменения`;
- кнопка `✓ Увидел` записывает подтверждение в D1 и существующий Apps Script;
- каждые 2 минуты Worker проверяет новую публикацию и рассылает изменения подписанным пользователям;
- профили, подтверждения и состояние доставок хранятся в Cloudflare D1;
- токен MAX, webhook-secret и Google API key хранятся только как Cloudflare Secrets.

## Бесплатный тариф

Для школьной нагрузки достаточно Workers Free + D1 Free. Отдельный VPS и домен для первого запуска не требуются. Cloudflare выдаст HTTPS-адрес `*.workers.dev`.

## Быстрый запуск через Cloudflare Dashboard

### 1. Создать аккаунт Cloudflare

Откройте Cloudflare Dashboard и войдите/зарегистрируйтесь.

### 2. Создать D1

Workers & Pages → D1 → Create database.

Имя:

`school20-max`

После создания скопируйте `Database ID`.

### 3. Создать Worker из GitHub

Workers & Pages → Create application → Import a repository.

Репозиторий:

`dzharman441302/school-schedule`

Root directory:

`max-worker`

Build command:

`npm install`

Deploy command:

`npx wrangler deploy`

Перед первым деплоем скопируйте `wrangler.toml.example` в `wrangler.toml` и замените `REPLACE_WITH_D1_DATABASE_ID` на ID созданной базы.

### 4. Создать таблицы D1

Через Cloudflare D1 Console выполните содержимое `schema.sql` целиком.

Либо через Wrangler:

`npx wrangler d1 execute school20-max --remote --file=./schema.sql`

### 5. Добавить Secrets

В Worker → Settings → Variables and Secrets добавьте как **Secret**:

- `BOT_TOKEN` — токен MAX;
- `WEBHOOK_SECRET` — придуманный секрет 20–40 символов, только латинские буквы, цифры, `_` и `-`;
- `SHEETS_API_KEY` — Google Sheets API key из текущего сайта.

Обычные переменные уже прописаны в шаблоне:

- `SPREADSHEET_ID`;
- `APPS_SCRIPT_URL`;
- `SCHOOL_SITE_URL`;
- `TIME_ZONE`.

### 6. Проверить Worker

Откройте:

`https://<worker>.workers.dev/health`

Ожидаемый ответ:

`{"ok":true,"service":"school20-max-bot","version":"0.2.0"}`

### 7. Зарегистрировать webhook MAX

Webhook URL:

`https://<worker>.workers.dev/webhook`

В PowerShell на своём компьютере:

```powershell
$token = "ВАШ_ТОКЕН_MAX"
$secret = "ТОТ_ЖЕ_WEBHOOK_SECRET"
$url = "https://<worker>.workers.dev/webhook"
$body = @{
  url = $url
  update_types = @("bot_started","message_created","message_callback")
  secret = $secret
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://platform-api2.max.ru/subscriptions" `
  -Headers @{ Authorization = $token } `
  -ContentType "application/json" `
  -Body $body
```

MAX должен вернуть `success: true`.

### 8. Проверить бота

Откройте бота в MAX и нажмите Start или отправьте `/start`.

Ожидаемая последовательность:

1. выбор `Учитель` / `Ученик / родитель`;
2. выбор фамилии или класса;
3. главное меню;
4. `Сегодня` показывает расписание;
5. `Изменения` показывает только изменённые уроки;
6. `Оповещения` показывает актуальное школьное сообщение.

## Секреты

Никогда не добавляйте настоящий `BOT_TOKEN`, `WEBHOOK_SECRET` или приватный API key в GitHub. Используйте Cloudflare Secrets.

## Health-check

`GET /health` не раскрывает секреты и подходит для проверки доступности Worker.

## Webhook

Worker принимает только:

`POST /webhook`

Если заголовок `X-Max-Bot-Api-Secret` неверный, возвращается HTTP 403.

## Автоматические уведомления

Cron запускается каждые 2 минуты. Worker читает `Статус_публикации`. Если появилась новая версия публикации, он сравнивает персональный набор изменений с предыдущим состоянием пользователя и отправляет уведомление только при реальном изменении.

Для учителя добавляется кнопка `✓ Увидел`. Подтверждение сохраняется в D1 и дублируется в существующий механизм `Просмотры_учителей` через Apps Script.

При первом обнаружении пользователя текущая версия считается базовой и задним числом не рассылается.

## Следующая версия

После проверки v0.2 можно добавить:

- несколько классов для одного родителя;
- админ-режим;
- список «кто не просмотрел»;
- утреннюю сводку;
- публикацию школьного оповещения из MAX;
- рассылку картинки и файлов из модуля `Оповещения`;
- персональную историю изменений после последнего просмотра.
