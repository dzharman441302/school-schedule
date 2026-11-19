# Достижения учащихся — серверная часть (Yandex Cloud)

Учителя вносят участие и результаты учеников через форму на сайте. Ответственный за олимпиады проверяет записи. Всё, где есть ФИО детей, хранится **только в Яндекс Облаке** (регион `ru-central1`): база Managed YDB и приватный бакет дипломов. В Google, Cloudflare и GitHub эти данные не попадают.

Этап 1 — серверная часть (этот каталог). Этап 2 — страницы `achievements-form.html` и `achievements-review.html`. Этап 3 — выгрузка на Яндекс Диск, импорт старого реестра, публичная страница.

## Как устроено

```
сайт (sosh20tver.ru) ──HTTPS──► API Gateway ──► Cloud Function (Python 3.12) ──► YDB (serverless)
        │                         https://<id>.apigw.yandexcloud.net    │
        └── presigned PUT/GET ──► Object Storage: приватный бакет дипломов ◄─┘
                                       Lockbox: ключ подписи токенов, ключ S3, токен Диска
```

| Папка | Что внутри |
|---|---|
| `function/` | код функции: `index.py` (точка входа `index.handler`), пакет `achievements/` |
| `function/achievements/config.py` | справочники (направления, уровни, формы, результаты, классы 1А–11А), лимиты |
| `schema/schema.yql` | таблицы YDB: `staff`, `records`, `audit`, `login_limits` |
| `deploy/terraform/` | все ресурсы облака; `deploy/apigw.yaml.tftpl` — спецификация шлюза |
| `tools/` | `init_db.py`, `seed_staff.py`, `set_pin.py`, `purge_old.py`, `build_zip.py` |
| `seed/` | `staff.csv` (56 педагогов) — **только на вашем компьютере**, в git не попадает; `staff.example.csv` — образец |
| `tests/` | pytest, база в памяти вместо YDB |

Классы можно поменять без правки кода: переменная окружения функции `ACHIEVEMENTS_CLASSES` (через запятую).

## API

Адрес — `https://<id>.apigw.yandexcloud.net`. Все ответы JSON, `Cache-Control: no-store`. Токен — заголовок `Authorization: Bearer <token>`. CORS — только `https://sosh20tver.ru` и `https://dzharman441302.github.io`.

| Запрос | Кто | Что делает |
|---|---|---|
| `POST /login` `{staff_id, pin}` | все | токен на 12 часов; 5 неверных PIN подряд → блокировка на 15 мин; с одного адреса не больше 30 попыток за 10 мин |
| `GET /staff` | все, **без токена** | список `{id, short_name}` для выбора «кто я» на форме входа (без токена его не показать до входа) |
| `GET /me` | вошедшие | кто я и моя роль |
| `GET /dictionaries` | вошедшие | справочники, классы, мероприятия из «Конкурсы_сайт» (кэш 30 мин), учебный год |
| `POST /records` | вошедшие | форма: мероприятие + `students: [{student_name, class_name, result, consent}]` → по записи на ученика. До 40 учеников за раз, до 200 записей в день |
| `GET /records/mine?year=2026` | вошедшие | мои записи (я автор или руководитель); возвращённые — сверху |
| `PUT /records/{id}` | автор | правка, пока «на проверке» или «возвращено»; после правки — снова «на проверке» |
| `DELETE /records/{id}` | автор | мягкое удаление, пока не проверено |
| `POST /diploma-upload-url` `{record_id, content_type, size}` | автор, руководитель | ссылка PUT на 15 мин; JPG/PNG/PDF до 10 МБ; тип и размер входят в подпись |
| `GET /records/{id}/diploma` | автор, руководитель, checker, admin | ссылка GET на 5 минут |
| `GET /review?status=new&level=&class_name=&supervisor_id=&event=&no_diploma=1` | checker, admin | очередь с превью дипломов и счётчиками по статусам |
| `POST /review/{id}` `{action: check\|return, comment}` | checker, admin | «Проверено» или «Вернуть» (комментарий обязателен) |
| `POST /review` `{action: "check", ids: [...]}` | checker, admin | массовая отметка «Проверено» (до 200) |
| `GET /export.xlsx?year=2026` | checker, admin | реестр за учебный год (лист «Достижения»; «Сводка» — этап 3) |
| `GET /admin/staff` | admin | педагоги, роли, есть ли PIN |
| `PUT /admin/staff/{id}` `{role, active}` | admin | сменить роль, отключить (себя — нельзя) |
| `POST /admin/staff/{id}/pin` | admin | новый PIN — показывается **один раз**; старые токены педагога перестают работать |

Ошибки: `{error, message}`, для формы ещё `errors: [{row, field, message}]` (`row` — номер ученика с нуля).

## Развёртывание (один раз, ~40 минут)

Команды — для PowerShell на Windows, из папки `yc-achievements`.

### 1. Аккаунт и инструменты

1. Облако на аккаунте школы (или общем рабочем), платёжный аккаунт привязан, доступ к облаку — минимум у двух человек (роль `admin` на облако второму человеку: «Права доступа» в консоли).
2. Установить [Yandex Cloud CLI](https://yandex.cloud/ru/docs/cli/quickstart) и войти: `yc init` (выбрать облако и каталог, зону `ru-central1-a`).
3. Установить [Terraform](https://yandex.cloud/ru/docs/tutorials/infrastructure-management/terraform-quickstart) и настроить зеркало провайдеров Яндекса — файл `%APPDATA%\terraform.rc`:
   ```
   provider_installation {
     network_mirror {
       url     = "https://terraform-mirror.yandexcloud.net/"
       include = ["registry.terraform.io/*/*"]
     }
     direct {
       exclude = ["registry.terraform.io/*/*"]
     }
   }
   ```
4. Python 3.12 и зависимости для скриптов:
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install ydb openpyxl pytest
   ```

### 2. Проверить и собрать код

```
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python tools\build_zip.py
```

### 3. Создать ресурсы облака

```
cd deploy\terraform
$env:YC_TOKEN = yc iam create-token
terraform init
terraform apply -var "cloud_id=$(yc config get cloud-id)" -var "folder_id=$(yc config get folder-id)"
```

Terraform создаёт:
- сервисный аккаунт функции `sosh20-achievements-fn`: `ydb.editor` только на эту базу, `lockbox.payloadViewer` только на этот секрет, чтение и запись только в бакет дипломов; ролей на весь каталог нет;
- сервисный аккаунт шлюза `sosh20-achievements-gw`: только `functions.functionInvoker` на эту функцию;
- YDB serverless `sosh20-achievements-db`;
- приватный бакет `sosh20-achievements-diplomas` (шифрование на стороне сервера, анонимный доступ закрыт, CORS для сайта). Имя бакета уникально во всём Object Storage — если занято, добавьте `-var "diploma_bucket=другое-имя"`;
- секрет Lockbox: случайный ключ подписи токенов, статический ключ S3 функции, заглушка для токена Яндекс Диска (этап 3);
- функцию `sosh20-achievements-api` (Python 3.12, 256 МБ) и API Gateway.

В конце Terraform печатает `api_url`, `ydb_endpoint`, `ydb_database`. Повторно: `terraform output`.

Файл `terraform.tfstate` содержит секреты: он в `.gitignore`, держите его только на своём компьютере (и в резервной копии в надёжном месте).

### 4. Создать таблицы и загрузить педагогов

```
cd ..\..
$env:YDB_ENDPOINT = terraform -chdir=deploy\terraform output -raw ydb_endpoint
$env:YDB_DATABASE = terraform -chdir=deploy\terraform output -raw ydb_database
$env:YDB_ACCESS_TOKEN_CREDENTIALS = yc iam create-token
.venv\Scripts\python tools\init_db.py
.venv\Scripts\python tools\seed_staff.py seed\staff.csv --dry-run
.venv\Scripts\python tools\seed_staff.py seed\staff.csv
```

`seed_staff.py` можно запускать повторно (дописали должности, пришёл новый учитель): существующие педагоги находятся по краткому ФИО, PIN и роль не трогаются (роль — только с `--update-roles`).

### 5. Первые PIN

Себе (администратору) — скриптом, сразу с ролью:
```
.venv\Scripts\python tools\set_pin.py "Фамилия И.О." --role admin
```
Ответственному за олимпиады — так же, с `--role checker`, или через `PUT /admin/staff/{id}` и `POST /admin/staff/{id}/pin` (на этапе 2 — кнопками в кабинете). Остальным PIN выдаются из кабинета администратора. PIN показывается один раз: передать лично (или позже через бот MAX). Забыл — выдать новый.

### 6. Подключить сайт

Вписать `api_url` в `config.js` (`achievementsApi: 'https://<id>.apigw.yandexcloud.net'`) — на этапе 2 вместе со страницами. Проверка: `https://<id>.apigw.yandexcloud.net/staff` открывается в браузере и показывает список педагогов.

### Обновление кода

```
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python tools\build_zip.py
cd deploy\terraform; $env:YC_TOKEN = yc iam create-token; terraform apply -var "cloud_id=..." -var "folder_id=..."
```
Terraform заметит новый архив (по хэшу) и выпустит новую версию функции. Изменения схемы — правкой `schema/schema.yql` и `tools/init_db.py` (для новых столбцов — `ALTER TABLE`, вручную в консоли YDB).

Логи: консоль → Cloud Functions → `sosh20-achievements-api` → «Логи». В них только метод, маршрут, код ответа и id педагога.

## Персональные данные

**Что хранится.** О педагогах — краткое и полное ФИО, должность, роль, хэш PIN (scrypt; сам PIN нигде не хранится). Об учениках — ФИО, класс, мероприятие, результат, отметка о согласии родителей на публикацию, файл диплома (фото или PDF).

**Где.** Только в Яндекс Облаке, регион `ru-central1` (Россия): таблицы YDB `records`, `staff`, `audit`; приватный бакет дипломов. Список мероприятий функция читает из публичного листа Google «Конкурсы_сайт» — туда ничего не пишется. Файл `seed/staff.csv` — только на компьютере администратора.

**Кто имеет доступ.**
- Учитель видит и правит только записи, где он автор или руководитель; дипломы — только к таким записям.
- Ответственный за олимпиады (`checker`) и администратор (`admin`) видят все записи и дипломы, скачивают реестр.
- Администратор выдаёт PIN и роли.
- Владельцы облака (минимум два человека) имеют технический доступ к базе и бакету через консоль.
- Ссылки на дипломы живут 5 минут; бакет закрыт для анонимного доступа.

**Журнал.** Таблица `audit`: кто и когда вошёл, создал, изменил, удалил, проверил, вернул запись, просматривал списки, открывал дипломы, скачивал реестр, выдавал PIN. В журнале только id и количества, без ФИО учеников.

**Публикация.** На сайт (этап 3) попадают только проверенные результаты; имя ученика (фамилия и имя) — только при отметке согласия. Отметку ставят, только если у школы есть письменное согласие родителей на распространение ФИО.

**Удаление записей выпускников.** Срок хранения определяет школа (приказ). Скрипт удаляет записи и файлы дипломов по дате мероприятия:
```
.venv\Scripts\python tools\purge_old.py --years 3          # показать, сколько будет удалено
$env:DIPLOMA_BUCKET = "sosh20-achievements-diplomas"
$env:S3_ACCESS_KEY = "..."; $env:S3_SECRET_KEY = "..."      # из секрета Lockbox
.venv\Scripts\python tools\purge_old.py --years 3 --yes    # удалить (необратимо)
```
`--years 3` в 2026/27 учебном году удаляет всё, что было до 01.09.2023. Если файлы дипломов удалить не удалось, записи не трогаются. Отдельную запись по просьбе родителей удаляет администратор в консоли YDB (`DELETE FROM records WHERE id = "..."`) вместе с файлом в бакете (`diplomas/<id записи>/`).

## Тесты

```
.venv\Scripts\python -m pytest -q tests
```
Проверяются: валидация формы и ФИО, учебный год с 1 сентября, разбиение формы на записи, роли и доступ (учитель не видит чужие записи и не может проверять), блокировка PIN и лимит по адресу, истечение и отзыв токенов, presigned-ссылки только для допущенных, подпись SigV4 (эталонный пример AWS), отсутствие ФИО в логах и журнале, CORS, выгрузка xlsx, сборка параметров YDB. В тестах только вымышленные ФИО. Docker не нужен: вместо YDB — база в памяти; запросы к настоящей YDB проверяются при первом запуске в облаке.
