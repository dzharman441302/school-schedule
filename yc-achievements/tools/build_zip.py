"""Собирает архив функции dist/function.zip (код + requirements.txt; зависимости ставит Cloud Functions).

    python tools/build_zip.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'function'
OUT = ROOT / 'dist' / 'function.zip'


def main():
    OUT.parent.mkdir(exist_ok=True)
    files = [SRC / 'index.py', SRC / 'requirements.txt', *sorted((SRC / 'achievements').glob('*.py'))]
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.relative_to(SRC).as_posix())
    print(f'{OUT} — {len(files)} файлов')


if __name__ == '__main__':
    main()
