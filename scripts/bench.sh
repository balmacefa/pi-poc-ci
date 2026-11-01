#!/usr/bin/env bash
# scripts/bench.sh - BENCHMARK VERIFIER para enjambre CVE
#
# Verifica de forma determinística (sin modelos, sin red) que los benchmarks
# en targets/ han sido correctamente parcheados:
#
#   demo-swarm      → lodash >= 4.17.12, minimist >= 1.2.6
#   code-fix-demo   → lodash >= 4.17.12 + index.js usa execFile (no exec+concat)
#
# Uso:
#   ./scripts/bench.sh
#
# Exit code:
#   0 - todos los benchmarks PASS
#   1 - algún benchmark FAIL

set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL_COUNT=0

# Función auxiliar: comparar versiones semver (major.minor.patch)
# Retorna 0 si $1 >= $2, 1 si no
version_gte() {
  local ver1="$1" ver2="$2"
  # Normalizar quitando 'v' o '^' prefijos
  ver1="${ver1#v}" ver1="${ver1#^}"
  ver2="${ver2#v}" ver2="${ver2#^}"
  
  IFS=. read -r v1_maj v1_min v1_pat <<< "$ver1"
  IFS=. read -r v2_maj v2_min v2_pat <<< "$ver2"
  
  v1_maj="${v1_maj:-0}" v1_min="${v1_min:-0}" v1_pat="${v1_pat:-0}"
  v2_maj="${v2_maj:-0}" v2_min="${v2_min:-0}" v2_pat="${v2_pat:-0}"
  
  if [[ $v1_maj -gt $v2_maj ]]; then return 0; fi
  if [[ $v1_maj -lt $v2_maj ]]; then return 1; fi
  if [[ $v1_min -gt $v2_min ]]; then return 0; fi
  if [[ $v1_min -lt $v2_min ]]; then return 1; fi
  if [[ $v1_pat -ge $v2_pat ]]; then return 0; fi
  return 1
}

# Función auxiliar: extraer versión de package.json
# $1: ruta a package.json, $2: nombre del paquete
get_pkg_version() {
  local pkg_json="$1" pkg_name="$2"
  # Buscar "paquete": "version" en dependencies
  grep -A 50 '"dependencies"' "$pkg_json" 2>/dev/null | 
    grep -E "\"$pkg_name\"\s*:\s*\"[^\"]+\"" | 
    sed -E 's/.*"[^"]+"\s*:\s*"([^"]+)".*/\1/' | 
    head -n1 || echo ""
}

echo "========================================"
echo "  BENCHMARK VERIFIER - Enjambre CVE"
echo "========================================"
echo

# ========================================
# BENCHMARK 1: demo-swarm
# ========================================
echo "▶ Benchmark: demo-swarm"
echo "  Remedios esperados:"
echo "    - lodash >= 4.17.12"
echo "    - minimist >= 1.2.6"
echo

BENCH1_FAIL=0
PKG_JSON="$ROOT/targets/demo-swarm/package.json"

if [[ ! -f "$PKG_JSON" ]]; then
  echo "  ✗ FAIL: package.json no encontrado"
  BENCH1_FAIL=1
else
  # Verificar lodash
  LODASH_VER=$(get_pkg_version "$PKG_JSON" "lodash")
  if [[ -z "$LODASH_VER" ]]; then
    echo "  ✗ FAIL: lodash no está en dependencies"
    BENCH1_FAIL=1
  elif version_gte "$LODASH_VER" "4.17.12"; then
    echo "  ✓ lodash $LODASH_VER (OK)"
  else
    echo "  ✗ FAIL: lodash $LODASH_VER < 4.17.12"
    BENCH1_FAIL=1
  fi
  
  # Verificar minimist
  MINIMIST_VER=$(get_pkg_version "$PKG_JSON" "minimist")
  if [[ -z "$MINIMIST_VER" ]]; then
    echo "  ✗ FAIL: minimist no está en dependencies"
    BENCH1_FAIL=1
  elif version_gte "$MINIMIST_VER" "1.2.6"; then
    echo "  ✓ minimist $MINIMIST_VER (OK)"
  else
    echo "  ✗ FAIL: minimist $MINIMIST_VER < 1.2.6"
    BENCH1_FAIL=1
  fi
fi

if [[ $BENCH1_FAIL -eq 0 ]]; then
  echo "  → PASS"
else
  echo "  → FAIL"
  ((FAIL_COUNT++))
fi
echo

# ========================================
# BENCHMARK 2: code-fix-demo
# ========================================
echo "▶ Benchmark: code-fix-demo"
echo "  Remedios esperados:"
echo "    - lodash >= 4.17.12"
echo "    - index.js NO usa exec() con concatenación (debe usar execFile)"
echo

BENCH2_FAIL=0
PKG_JSON="$ROOT/targets/code-fix-demo/package.json"
INDEX_JS="$ROOT/targets/code-fix-demo/index.js"

# Verificar lodash
if [[ ! -f "$PKG_JSON" ]]; then
  echo "  ✗ FAIL: package.json no encontrado"
  BENCH2_FAIL=1
else
  LODASH_VER=$(get_pkg_version "$PKG_JSON" "lodash")
  if [[ -z "$LODASH_VER" ]]; then
    echo "  ✗ FAIL: lodash no está en dependencies"
    BENCH2_FAIL=1
  elif version_gte "$LODASH_VER" "4.17.12"; then
    echo "  ✓ lodash $LODASH_VER (OK)"
  else
    echo "  ✗ FAIL: lodash $LODASH_VER < 4.17.12"
    BENCH2_FAIL=1
  fi
fi

# Verificar que index.js NO tenga exec() con concatenación
if [[ ! -f "$INDEX_JS" ]]; then
  echo "  ✗ FAIL: index.js no encontrado"
  BENCH2_FAIL=1
else
  # Patrón vulnerable: exec("algo" + variable) o exec('algo' + variable)
  # Buscar require("child_process").exec (el vulnerable)
  if grep -qE 'require\(["\x27]child_process["\x27]\)\.exec' "$INDEX_JS" 2>/dev/null; then
    echo "  ✗ FAIL: index.js todavía importa exec directamente de child_process"
    BENCH2_FAIL=1
  elif grep -qE '\bexec\s*\(' "$INDEX_JS" 2>/dev/null; then
    # Hay alguna llamada a exec()
    echo "  ✗ FAIL: index.js todavía contiene llamadas a exec()"
    BENCH2_FAIL=1
  else
    # Verificar que usa execFile
    if grep -qE '\bexecFile\s*\(' "$INDEX_JS" 2>/dev/null; then
      echo "  ✓ index.js usa execFile (OK)"
    else
      echo "  ✗ FAIL: index.js no usa exec pero tampoco execFile (¿código eliminado?)"
      BENCH2_FAIL=1
    fi
  fi
fi

if [[ $BENCH2_FAIL -eq 0 ]]; then
  echo "  → PASS"
else
  echo "  → FAIL"
  ((FAIL_COUNT++))
fi
echo

# ========================================
# RESULTADO FINAL
# ========================================
echo "========================================"
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "✓ TODOS LOS BENCHMARKS PASARON"
  echo "========================================"
  exit 0
else
  echo "✗ $FAIL_COUNT BENCHMARK(S) FALLARON"
  echo "========================================"
  exit 1
fi
