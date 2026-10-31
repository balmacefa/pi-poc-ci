# pi CI POC: layered customization

| Layer | File | Effect |
|---|---|---|
| 1 Settings | `.pi/settings.json` | Gemini flash, low thinking, limited tools, retries |
| 2 Instructions | `AGENTS.md`, `.pi/APPEND_SYSTEM.md` | Repo rules and non-interactive CI behavior |
| 3 Prompt template | `.pi/prompts/review.md` | `/review [focus]` |
| 4 Skill | `.pi/skills/ci-triage/SKILL.md` | `/skill:ci-triage` |
| 5 MCP | `.pi/mcp.json` | Filesystem server, disabled by default |
| 6 Extension | `.pi/extensions/ci-guard.ts` | Blocks risky bash and writes outside `src/`, audit log, `ci_status` tool |

`src/app.js` has deliberate bugs (off-by-one, SQL injection, command injection) for the review.

## Run

```bash
export GEMINI_API_KEY=...        # or rely on ~/.pi/agent/auth.json
export PI_CLI="node C:/Users/fabia/pi-harness-src/packages/coding-agent/dist/bundle/cli.js"
./run-poc.sh review              # or: triage, guard, all
```

Output of the audit trail goes to `.pi/ci-audit.jsonl`.

## Docker (UBI 9)

```bash
cp .env.example .env                       # then fill in GEMINI_API_KEY (or export it in your shell)
docker compose build
docker compose run --rm pi                 # interactive pi in /workspace
docker compose run --rm pi -p --no-session -a "/review security"
docker compose --profile ci run --rm poc   # runs ./run-poc.sh all
```

- `./` is bind-mounted at `/workspace`, so edits on the host and in the container are the same files.
- The local pi checkout (`../pi-harness-src/packages/coding-agent`, override with `PI_LOCAL_DIR`) is linked read-only at `/opt/pi-local` and used by default. Its dependencies are taken from the pi installed from npm in the image (`NODE_PATH` in `docker/entrypoint.sh`), because the checkout's `node_modules` live at the repo root. Without the mount, the npm pi runs. The `poc` service exits with 1 when the review ends in `VERDICT: FAIL`, which is expected for `src/app.js`.
- Pi settings, sessions and downloaded tools live in the `pi-agent-home` volume. Your host `~/.pi/agent` is not mounted, so the container does not see your saved credentials; pass keys with environment variables.
- Keys come from the host environment or `.env`; they are never written into the image.

Notes: `-a` trusts this project's `.pi` folder, required in print mode. Do not use `-a` on untrusted repos or forks.
