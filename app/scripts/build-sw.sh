#!/usr/bin/env bash
# Обновляет список файлов оффлайн-кэша в sw.js после добавления/удаления файлов.
set -euo pipefail
cd "$(dirname "$0")/.."
LIST=$( (echo ./ ; printf '%s\n' index.html styles.css manifest.webmanifest; ls icons/*; find src -name '*.js' | sort) | sed "s#^#    '#; s#\$#',#")
python3 - "$LIST" <<'EOF'
import re, sys
p = 'sw.js'
s = open(p).read()
s = re.sub(r"const SHELL = \[\n.*?\n\];", "const SHELL = [\n" + sys.argv[1] + "\n];", s, flags=re.S)
open(p, 'w').write(s)
EOF
echo "sw.js обновлён"
