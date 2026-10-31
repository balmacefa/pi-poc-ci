#!/usr/bin/env bash
# Runs IBM Bob Shell as one of the project's agents, in headless mode.
#   scripts/bob.sh run "<prompt>"              one-shot task; prints Bob's answer
#   scripts/bob.sh review [focus]              reviews the repo and ends with a VERDICT line
#   scripts/bob.sh resume <task-id> "<prompt>" follow-up on a previous task (keeps context)
#
# Auth: BOB_API_KEY (from your IBM Bob trial/account). Set it in the environment or .env.
# Config: BOB_CLI (bob command), BOB_MAX_TURNS (default 15), BOB_RUN_ARGS (extra `bob run` flags).
# Exit code (review): 0 on "VERDICT: PASS", 1 on "VERDICT: FAIL", 2 when Bob gives no verdict.
#
# NOTE: Bob is a separate agent. It needs network access and does NOT use pi's cve_* tools or
# the ci-guard path guard. Keep it out of the offline, guarded CVE flow (scripts/cve.sh).
set -u
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites arguments starting with "/"; keep them literal.
export MSYS_NO_PATHCONV=1
BOB_CLI="${BOB_CLI:-bob}"
: "${BOB_API_KEY:?set BOB_API_KEY (IBM Bob API key) in the environment or .env}"
MAX_TURNS="${BOB_MAX_TURNS:-15}"

# Extracts last_message from Bob's JSON result (falls back to raw output).
last_message() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const line=d.trim().split(/\r?\n/).filter(Boolean).pop();process.stdout.write((JSON.parse(line).last_message)||d)}catch(e){process.stdout.write(d)}})'
}

mode="${1:-}"
case "$mode" in
  run)
    shift
    [ "$#" -ge 1 ] || { echo "usage: $0 run \"<prompt>\"" >&2; exit 64; }
    # shellcheck disable=SC2086
    exec "$BOB_CLI" run --accept-license --trust ${BOB_RUN_ARGS:-} "$*" < /dev/null
    ;;

  review)
    focus="${2:-security}"
    prompt="Review this repository (start with src/app.js and the project files) for ${focus} issues: bugs, injection, and unsafe patterns. Be concise. Finish with a single final line that is exactly 'VERDICT: PASS' if you found no material issues or 'VERDICT: FAIL' if you did."
    # shellcheck disable=SC2086
    out=$(timeout 600 "$BOB_CLI" run --accept-license --trust --max-turns "$MAX_TURNS" --format json ${BOB_RUN_ARGS:-} "$prompt" < /dev/null) || {
      code=$?; echo "$out"; echo "bob failed with exit code $code" >&2; exit "$code"
    }
    msg=$(printf '%s' "$out" | last_message)
    echo "$msg"
    case "$(printf '%s' "$msg" | tail -n 1)" in
      *"VERDICT: PASS"*) exit 0 ;;
      *"VERDICT: FAIL"*) exit 1 ;;
      *) exit 2 ;;
    esac
    ;;

  resume)
    [ -n "${2:-}" ] && [ -n "${3:-}" ] || { echo "usage: $0 resume <task-id> \"<prompt>\"" >&2; exit 64; }
    task_id="$2"; shift 2
    # shellcheck disable=SC2086
    exec "$BOB_CLI" run -r "$task_id" --accept-license --trust ${BOB_RUN_ARGS:-} "$*" < /dev/null
    ;;

  *)
    echo "usage: $0 run \"<prompt>\" | review [focus] | resume <task-id> \"<prompt>\"" >&2
    exit 64 ;;
esac
