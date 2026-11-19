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
  description = "OAuth-токен Яндекс Диска (этап 3). До этапа 3 — заглушка."
  default     = "not-set-until-stage-3"
  sensitive   = true
}
