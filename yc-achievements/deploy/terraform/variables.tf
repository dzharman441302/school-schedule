variable "cloud_id" {
  type        = string
  description = "ID облака (yc config get cloud-id)"
}

variable "folder_id" {
  type        = string
  description = "ID каталога (yc config get folder-id)"
}

variable "prefix" {
  type    = string
  default = "sosh20-achievements"
}

variable "diploma_bucket" {
  type        = string
  description = "Имя приватного бакета дипломов — уникально во всём Object Storage"
  default     = "sosh20-achievements-diplomas"
}

variable "public_bucket" {
  type        = string
  description = "Бакет с публичным achievements.json — уникальное имя"
  default     = "sosh20-achievements-public"
}

variable "yadisk_path" {
  type        = string
  description = "Куда класть реестр на Яндекс Диске; {year} заменяется на 2026-2027"
  default     = "/Школа/Достижения/Реестр достижений (выгрузка).xlsx"
}

variable "allowed_origins" {
  type    = list(string)
  default = ["https://sosh20tver.ru", "https://dzharman441302.github.io"]
}

variable "sheet_id" {
  type        = string
  description = "ID публичной Google Таблицы с листом «Конкурсы_сайт» (как в config.js)"
  default     = "1Va5atMLtrqb9JEXE7d9eytoTUFgN-lwT0xlYOevm4S4"
}

variable "contests_sheet" {
  type    = string
  default = "Конкурсы_сайт"
}

variable "function_zip" {
  type        = string
  description = "Архив функции, собирается python tools/build_zip.py"
  default     = "../../dist/function.zip"
}

variable "yadisk_token" {
  type        = string
  description = "OAuth-токен Яндекс Диска с правом записи (см. README, «Выгрузка на Яндекс Диск»)"
  default     = "not-set" # пока «not-set», выгрузка на Диск пропускается с ошибкой no-token
  sensitive   = true
}
