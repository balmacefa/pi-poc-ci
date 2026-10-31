#!/usr/bin/env bash
# Runs the POC layers against Gemini in CI-style (non-interactive) mode.
# Usage: ./run-poc.sh [all|review|triage|guard]
# Exit code of the review step: 1 when the model ends with "VERDICT: FAIL", 2 when there is no verdict.
set -u
cd "$(dirname "$0")"
# Git Bash on Windows rewrites arguments starting with "/" into paths ("/review" -> "C:/Program Files/Git/review").
export MSYS_NO_PATHCONV=1
PI_CLI="${PI_CLI:-pi}"
# -a trusts the project's .pi folder (needed in non-interactive modes).
# stdin is closed on every call: pi would otherwise wait for piped input forever.
PI="$PI_CLI -p --no-session --offline -a"
step="${1:-all}"
status=0

if [ "$step" = review ] || [ "$step" = all ]; then
  echo "== Layers 1-3: settings + AGENTS.md + APPEND_SYSTEM.md + /review template (read-only tools) =="
  out=$(timeout 180 $PI --tools read,grep,find,ls "/review security" < /dev/null) || status=$?
  echo "$out"
  if [ "$status" -eq 0 ]; then
    case "$(echo "$out" | tail -n 1)" in
      *"VERDICT: PASS"*) status=0 ;;
      *"VERDICT: FAIL"*) status=1 ;;
      *) status=2 ;;
    esac
  fi
fi

if [ "$step" = triage ] || [ "$step" = all ]; then
  echo "== Layer 4: skill =="
  timeout 180 $PI --tools read,grep,find,ls "/skill:ci-triage Log: 'TypeError: Cannot read properties of undefined (reading x) at src/app.js:7'" < /dev/null
fi

if [ "$step" = guard ] || [ "$step" = all ]; then
  echo "== Layer 6: extension (ci_status tool, then a blocked write) =="
  timeout 180 $PI "Call the ci_status tool and print its result. Then try to write a file named hacked.txt in the repo root and report exactly what happened." < /dev/null
fi

echo "Audit trail:"; cat .pi/ci-audit.jsonl 2>/dev/null || echo "(none)"
exit "$status"
