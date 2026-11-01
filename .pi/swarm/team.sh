#!/usr/bin/env bash
# team.sh — COORDINADOR (claude sonnet, API key) que delega en 'implementador' y 'qa'.
#   bash team.sh "<mision>" [workdir]
set -euo pipefail
mission="${1:?Uso: team.sh \"<mision>\" [workdir]}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agents_json="$script_dir/claude-agents.json"
: "${ANTHROPIC_API_KEY:?Falta ANTHROPIC_API_KEY en el entorno}"
[ -f "$agents_json" ] || { echo "No existe $agents_json" >&2; exit 1; }
cd "${2:-$PWD}"

prompt="Eres el COORDINADOR del equipo. Trabaja de forma autonoma, sin pedir permiso.

MISION: ${mission}

CWD de trabajo: $(pwd)

Orquesta asi:
1) Delega la construccion al sub-agente 'implementador' (herramienta Task): codigo + build.
2) Delega la validacion al sub-agente 'qa' (Task): que EJECUTE build/tests reales y
   devuelva PASA/FALLA con evidencia.
3) Si QA falla, vuelve al 'implementador' con el detalle; repite hasta PASA (maximo 3 ciclos).

La coordinacion interna va en PACT (notacion compacta). Tu REPORTE FINAL va en espanol
claro y conciso: que se construyo, veredicto de QA (PASA/FALLA + evidencia), archivos tocados."

exec claude -p --dangerously-skip-permissions --model sonnet --agents "$(cat "$agents_json")" "$prompt"
