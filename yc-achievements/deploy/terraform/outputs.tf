output "api_url" {
  description = "Вписать в config.js → achievementsApi"
  value       = "https://${yandex_api_gateway.api.domain}"
}

output "ydb_endpoint" {
  value = "grpcs://${yandex_ydb_database_serverless.db.ydb_api_endpoint}"
}

output "ydb_database" {
  value = yandex_ydb_database_serverless.db.database_path
}

output "diploma_bucket" {
  value = yandex_storage_bucket.diplomas.bucket
}

output "public_json_url" {
  description = "Вписать в config.js → achievementsPublicUrl"
  value       = "https://storage.yandexcloud.net/${yandex_storage_bucket.public.bucket}/achievements.json"
}
