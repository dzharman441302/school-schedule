# «Достижения учащихся» в Yandex Cloud, регион ru-central1.
# Всё с ФИО учеников хранится только здесь: YDB и приватный бакет.

# --- Сервисные аккаунты ---------------------------------------------------

# От его имени работает функция: YDB, Lockbox, бакет дипломов. Ролей на каталог нет.
resource "yandex_iam_service_account" "fn" {
  name        = "${var.prefix}-fn"
  description = "Функция API достижений"
}

# От его имени API Gateway и таймеры вызывают функцию — и только это.
resource "yandex_iam_service_account" "gw" {
  name        = "${var.prefix}-gw"
  description = "API Gateway достижений"
}

# Статический ключ функции — для presigned-ссылок на дипломы. Хранится в Lockbox.
resource "yandex_iam_service_account_static_access_key" "fn" {
  service_account_id = yandex_iam_service_account.fn.id
  description        = "presigned URLs for diplomas"
}

# --- YDB ------------------------------------------------------------------

resource "yandex_ydb_database_serverless" "db" {
  name        = "${var.prefix}-db"
  location_id = "ru-central1"
}

resource "yandex_ydb_database_iam_binding" "fn_editor" {
  database_id = yandex_ydb_database_serverless.db.id
  role        = "ydb.editor"
  members     = ["serviceAccount:${yandex_iam_service_account.fn.id}"]
}

# --- Object Storage: приватный бакет дипломов ------------------------------

resource "yandex_storage_bucket" "diplomas" {
  bucket    = var.diploma_bucket
  folder_id = var.folder_id
  max_size  = 5368709120 # 5 ГБ

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  grant {
    id          = yandex_iam_service_account.fn.id
    type        = "CanonicalUser"
    permissions = ["READ", "WRITE"]
  }

  # Браузер учителя загружает файл напрямую по presigned-ссылке, проверяющий смотрит превью.
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["content-type"]
    max_age_seconds = 600
  }

  # Шифрование своим ключом (SSE) в Яндекс Облаке возможно только через KMS (aws:kms) —
  # не включаем: нужен платный ключ и права функции на него. Анонимный доступ закрыт выше.
}

# --- Object Storage: публичный achievements.json (этап 3) --------------------------
# Только проверенные результаты, имя ученика — только с согласием. Читать может любой, писать — функция.

resource "yandex_storage_bucket" "public" {
  bucket    = var.public_bucket
  folder_id = var.folder_id
  max_size  = 104857600 # 100 МБ

  anonymous_access_flags {
    read        = true
    list        = false
    config_read = false
  }

  grant {
    id          = yandex_iam_service_account.fn.id
    type        = "CanonicalUser"
    permissions = ["READ", "WRITE"] # Object Storage не выдаёт WRITE без READ
  }

  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = var.allowed_origins
    max_age_seconds = 600
  }
}

# --- Lockbox: секреты -------------------------------------------------------

resource "random_password" "token_secret" {
  length  = 48
  special = false
}

resource "yandex_lockbox_secret" "api" {
  name        = "${var.prefix}-secrets"
  description = "Ключ подписи токенов, ключ S3 функции, OAuth-токен Яндекс Диска"
}

resource "yandex_lockbox_secret_version" "api" {
  secret_id = yandex_lockbox_secret.api.id
  entries {
    key        = "TOKEN_SECRET"
    text_value = random_password.token_secret.result
  }
  entries {
    key        = "S3_ACCESS_KEY"
    text_value = yandex_iam_service_account_static_access_key.fn.access_key
  }
  entries {
    key        = "S3_SECRET_KEY"
    text_value = yandex_iam_service_account_static_access_key.fn.secret_key
  }
  entries {
    key        = "YADISK_TOKEN"
    text_value = var.yadisk_token
  }
}

resource "yandex_lockbox_secret_iam_binding" "fn_viewer" {
  secret_id = yandex_lockbox_secret.api.id
  role      = "lockbox.payloadViewer"
  members   = ["serviceAccount:${yandex_iam_service_account.fn.id}"]
}

# --- Cloud Function -------------------------------------------------------

resource "yandex_function" "api" {
  name               = "${var.prefix}-api"
  description        = "API достижений учащихся"
  runtime            = "python312"
  entrypoint         = "index.handler"
  memory             = 256
  execution_timeout  = "30"
  service_account_id = yandex_iam_service_account.fn.id
  user_hash          = filesha256(var.function_zip)

  content {
    zip_filename = var.function_zip
  }

  environment = {
    YDB_ENDPOINT    = "grpcs://${yandex_ydb_database_serverless.db.ydb_api_endpoint}"
    YDB_DATABASE    = yandex_ydb_database_serverless.db.database_path
    DIPLOMA_BUCKET  = yandex_storage_bucket.diplomas.bucket
    PUBLIC_BUCKET   = yandex_storage_bucket.public.bucket
    YADISK_PATH     = var.yadisk_path
    ALLOWED_ORIGINS = join(",", var.allowed_origins)
    SHEET_ID        = var.sheet_id
    CONTESTS_SHEET  = var.contests_sheet
  }

  dynamic "secrets" {
    for_each = ["TOKEN_SECRET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "YADISK_TOKEN"]
    content {
      id                   = yandex_lockbox_secret.api.id
      version_id           = yandex_lockbox_secret_version.api.id
      key                  = secrets.value
      environment_variable = secrets.value
    }
  }

  depends_on = [
    yandex_lockbox_secret_iam_binding.fn_viewer,
    yandex_ydb_database_iam_binding.fn_editor,
  ]
}

# Таймеры (время UTC; Москва = UTC+3). Вызывают функцию от имени аккаунта шлюза — у него только право вызова.
resource "yandex_function_trigger" "export_disk" {
  name        = "${var.prefix}-export-disk"
  description = "Реестр на Яндекс Диск раз в час, 07:00–21:00 МСК"
  timer {
    cron_expression = "0 4-18 ? * * *"
    payload         = "export_disk"
  }
  function {
    id                 = yandex_function.api.id
    service_account_id = yandex_iam_service_account.gw.id
  }
  depends_on = [yandex_function_iam_binding.gw_invoker]
}

resource "yandex_function_trigger" "publish" {
  name        = "${var.prefix}-publish"
  description = "achievements.json раз в 30 минут"
  timer {
    cron_expression = "*/30 * ? * * *"
    payload         = "publish"
  }
  function {
    id                 = yandex_function.api.id
    service_account_id = yandex_iam_service_account.gw.id
  }
  depends_on = [yandex_function_iam_binding.gw_invoker]
}

resource "yandex_function_iam_binding" "gw_invoker" {
  function_id = yandex_function.api.id
  role        = "functions.functionInvoker"
  members     = ["serviceAccount:${yandex_iam_service_account.gw.id}"]
}

# --- API Gateway ----------------------------------------------------------

resource "yandex_api_gateway" "api" {
  name        = "${var.prefix}-gw"
  description = "https://<id>.apigw.yandexcloud.net — адрес achievementsApi в config.js"
  spec = templatefile("${path.module}/../apigw.yaml.tftpl", {
    function_id        = yandex_function.api.id
    service_account_id = yandex_iam_service_account.gw.id
  })
  depends_on = [yandex_function_iam_binding.gw_invoker]
}
