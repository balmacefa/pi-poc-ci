#!/usr/bin/env bash
# Runs the CVE workflow with pi in one of two modes.
#   scripts/cve.sh investigate [path]       read-only: scan, study past fixes, download CVE details, write reports/
#   scripts/cve.sh patch <id> [path]        write: fix one CVE on branch cve/<id> and push it to origin
# Environment: PI_CLI (pi command), PI_MODEL_ARGS (for example "--provider anthropic --model claude-haiku-4-5").
# Exit code: 0 on "VERDICT: PASS", 1 on "VERDICT: FAIL", 2 when pi gives no verdict.
set -u
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites arguments starting with "/" into paths ("/cve-patch" -> "C:/Program Files/Git/cve-patch").
export MSYS_NO_PATHCONV=1
PI_CLI="${PI_CLI:-pi}"
READ_TOOLS="read,grep,find,ls,cve_scan,cve_details,cve_prior_fixes,cve_report"

mode="${1:-}"
case "$mode" in
  investigate)
    prompt="/cve-investigate ${2:-}"
    tools="$READ_TOOLS" ;;
  patch)
    [ -n "${2:-}" ] || { echo "usage: $0 patch <CVE-or-GHSA-id> [path]" >&2; exit 64; }
    prompt="/cve-patch $2 ${3:-}"
    tools="$READ_TOOLS,edit,cve_branch,cve_commit_push" ;;
  *)
    echo "usage: $0 investigate [path] | patch <id> [path]" >&2; exit 64 ;;
esac

# stdin is closed: pi would otherwise wait for piped input forever.
# shellcheck disable=SC2086
out=$(timeout 600 $PI_CLI -p --no-session --offline -a --cve-mode "$mode" --tools "$tools" ${PI_MODEL_ARGS:-} "$prompt" < /dev/null) || {
  code=$?; echo "$out"; echo "pi failed with exit code $code" >&2; exit "$code"
}
echo "$out"
case "$(echo "$out" | tail -n 1)" in
  *"VERDICT: PASS"*) exit 0 ;;
  *"VERDICT: FAIL"*) exit 1 ;;
  *) exit 2 ;;
esac
