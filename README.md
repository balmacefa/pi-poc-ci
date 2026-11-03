# pi-poc-ci

![Security Status](site/security-badge.svg)

Proof of concept: customizing the [pi](https://github.com/earendil-works/pi) coding agent for CI/CD, with a CVE investigation and patch workflow.

## Layers

| Layer | File | Effect |
|---|---|---|
| Settings | `.pi/settings.json` | Gemini flash by default; Claude and Gemini models in the Ctrl+P cycle; limited tools; retries |
| Instructions | `AGENTS.md`, `.pi/APPEND_SYSTEM.md` | Repo rules and non-interactive CI behavior (`VERDICT:` line) |
| Prompt templates | `.pi/prompts/` | `/review`, `/cve-investigate`, `/cve-patch` |
| Skills | `.pi/skills/` | `ci-triage` plus the author's `idea-a-producto-publicado`, `production-audit`, `ce-optimize` |
| MCP | `.pi/mcp.json` | Filesystem server, disabled by default |
| Extension | `.pi/extensions/ci-guard.ts`, `.pi/extensions/cve/` | Path guard, audit log, modes, `cve_*` tools |

## CVE workflow

`targets/vuln-app` is a fixture with pinned, vulnerable dependencies. Its git history holds one earlier CVE fix (`CVE-2018-16487`) that serves as the reference for how fixes are made here. The extension adds the flag `--cve-mode` and these tools:

| Tool | Modes | What it does |
|---|---|---|
| `cve_scan` | both | Queries OSV for the pinned dependencies of a project |
| `cve_details` | both | Downloads one advisory from OSV (follows GHSA aliases for fixed versions); saves raw JSON under `reports/cve/` |
| `cve_prior_fixes` | both | Lists earlier commits that mention `CVE-` with their diffs |
| `cve_report` | both | Writes `reports/cve/<id>.md` |
| `cve_branch` | patch | Creates `cve/<id>` |
| `cve_commit_push` | patch | Commits `targets/` and `reports/` only and pushes `origin cve/<id>` |

| Mode | Can write | Shell |
|---|---|---|
| none | `src/` | follows `defaultTools` (off) |
| `investigate` | `reports/` | blocked |
| `patch` | `targets/`, `reports/` | blocked; never touches `main` |

```bash
export PI_CLI="node C:/Users/fabia/pi-harness-src/packages/coding-agent/dist/bundle/cli.js"
scripts/cve.sh investigate                 # scan, read past fixes, download details, write reports/
scripts/cve.sh patch GHSA-xxxx-xxxx-xxxx   # fix on branch cve/<id> and push it to origin
PI_MODEL_ARGS="--provider anthropic --model claude-haiku-4-5" scripts/cve.sh investigate
```

The exit code follows the final `VERDICT:` line (0 PASS, 1 FAIL, 2 none). An investigation that finds vulnerabilities ends in FAIL, by design.

## Models

Claude and Gemini are both configured. See [docs/MODELS.md](docs/MODELS.md) for authentication on the host and in Docker.

## Agents

pi (with Gemini/Claude) runs the guarded CVE flow. [IBM Bob](https://bob.ibm.com) is available as a
second, general-purpose agent via `scripts/bob.sh` (needs `BOB_API_KEY` and network). Bob does not use
pi's `cve_*` tools or the ci-guard, so it stays out of the offline CVE pipeline. See [docs/BOB.md](docs/BOB.md).

```bash
export BOB_API_KEY="..."
scripts/bob.sh run "Reply with the single word: pong"
scripts/bob.sh review security          # repo review; VERDICT exit code
```

## Tests

```bash
npm test          # 36 unit tests (node:test, no network)
node test/online.smoke.ts   # optional live OSV check
```

## Security report

Generate a consolidated HTML report from CVE scan results:

```bash
node scripts/security-report.mjs
```

Opens `site/report.html` — a shareable, self-contained security dashboard with:
- KPIs: total CVEs found, patched, severity breakdown
- Full CVE table with links to OSV advisories
- Tool usage and model stats

A `site/security-badge.svg` shield is also generated (red if critical CVEs, green otherwise).

## Original CI demo

```bash
./run-poc.sh review              # or: triage, guard, all
```

`src/app.js` has deliberate bugs (off-by-one, SQL injection, command injection) for `/review`. The audit trail goes to `.pi/ci-audit.jsonl`.

## Docker (UBI 9)

```bash
cp .env.example .env                       # then fill in GEMINI_API_KEY and/or ANTHROPIC_API_KEY
docker compose build
docker compose run --rm pi                 # interactive pi in /workspace
docker compose --profile ci run --rm poc   # runs ./run-poc.sh all
docker compose run --rm bob run "..."       # IBM Bob agent (needs BOB_API_KEY in .env)
```

- `./` is bind-mounted at `/workspace`, so edits on the host and in the container are the same files.
- The local pi checkout (`../pi-harness-src/packages/coding-agent`, override with `PI_LOCAL_DIR`) is linked read-only at `/opt/pi-local` and used by default. Its dependencies come from the pi installed from npm in the image (`NODE_PATH` in `docker/entrypoint.sh`). Without the mount, the npm pi runs.
- Pi settings, sessions and downloaded tools live in the `pi-agent-home` volume. Your host `~/.pi/agent` is not mounted; pass keys with environment variables. Git push from the container needs credentials that this setup does not provide.

## Safety notes

- `-a` trusts this project's `.pi` folder, required in print mode. Do not use it on untrusted repos or forks.
- Pi has no sandbox. The guard limits pi's file tools, not shell commands, which is why shell tools stay off.
- Pass `< /dev/null` when calling pi from scripts, or it waits for piped input.

License: MIT.
