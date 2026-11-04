#!/usr/bin/env bash
# Обновляет оффлайн-кэш в sw.js: список файлов и версию (хеш их содержимого).
# Запускать после любого изменения файлов сайта; CI проверяет, что sw.js актуален.
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=$( (printf '%s\n' index.html styles.css manifest.webmanifest; find icons src vendor -type f \( -name '*.js' -o -name '*.css' -o -name '*.png' -o -name '*.svg' \) 2>/dev/null | LC_ALL=C sort) )
HASH=$(printf '%s\n' $FILES | xargs sha256sum | sha256sum | cut -c1-10)
LIST=$( (echo ./ ; printf '%s\n' $FILES) | sed "s#^#    '#; s#\$#',#")
python3 - "$LIST" "$HASH" <<'EOF'
import re, sys
p = 'sw.js'
s = open(p).read()
s = re.sub(r"const SHELL = \[\n.*?\n\];", lambda m: "const SHELL = [\n" + sys.argv[1] + "\n];", s, flags=re.S)
s = re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'rt-{sys.argv[2]}';", s)
open(p, 'w').write(s)
EOF
echo "sw.js: версия rt-$HASH"
