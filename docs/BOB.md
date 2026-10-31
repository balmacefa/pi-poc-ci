# IBM Bob as a project agent

[IBM Bob](https://bob.ibm.com) (Bob Shell, npm package `@ibm/bob`) is available as a second agent
in this POC, next to pi. It is a **separate engine** with its own backend, tools and modes.

## What Bob is and is not here

- It runs general tasks and code reviews on the repo through `scripts/bob.sh`.
- It is **not** wired into the guarded CVE flow (`scripts/cve.sh`). Bob does not use pi's
  `cve_*` tools, the `ci-guard` path guard, the audit log, or pi's `--offline` mode.
- It **requires network access** (`api.us-east.bob.ibm.com`, IBM IAM). Do not expect it to work
  in an offline CI step.

## Authentication

Bob authenticates with an API key from your IBM Bob trial or account.

- Host: `export BOB_API_KEY="..."` (never commit it).
- Docker: put it in `.env` (`BOB_API_KEY=...`); compose passes it to the container.

License consent and config persist in `~/.bob` on the host and in the `bob-home` volume in Docker.
The wrapper always passes `--accept-license --trust`.

## Usage (host)

```bash
export BOB_API_KEY="..."
scripts/bob.sh run "Reply with the single word: pong"       # one-shot task
scripts/bob.sh review security                              # repo review; sets VERDICT exit code
scripts/bob.sh resume <task-id> "follow-up question"        # continue a previous task (keeps context)
```

Exit code of `review`: 0 on `VERDICT: PASS`, 1 on `VERDICT: FAIL`, 2 when there is no verdict —
the same convention pi uses in `run-poc.sh` and `cve.sh`.

Knobs: `BOB_CLI` (bob command), `BOB_MAX_TURNS` (default 15), `BOB_RUN_ARGS` (extra `bob run` flags).

## Usage (Docker, UBI 9)

The image installs `@ibm/bob` (pin with `BOB_VERSION`). A `bob` compose service runs the wrapper:

```bash
cp .env.example .env            # fill in BOB_API_KEY
docker compose build
docker compose run --rm bob run "Reply with the single word: pong"
docker compose run --rm bob review security
```

## Why Bob is not in the CVE pipeline

The POC's safety guarantees (write scoping by mode, blocked shell, offline, commit-only-`targets/`)
live inside pi's extension. Bob cannot reuse them, so putting Bob on the patch path would drop those
guardrails. Keep Bob for exploratory review and general tasks; use pi for the guarded `investigate`
and `patch` modes.
