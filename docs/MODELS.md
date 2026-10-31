# Models: Gemini and Claude

The POC defaults to Gemini (`google/gemini-2.5-flash`, see `.pi/settings.json`). Claude is configured as a second provider. Both can be used in the same session.

## Scoped models

`enabledModels` in `.pi/settings.json` limits what Ctrl+P cycles through:

| Provider | Cheap | Strong |
| --- | --- | --- |
| google | `gemini-2.5-flash` | `gemini-3.1-pro-preview` |
| anthropic | `claude-haiku-4-5` | `claude-sonnet-4-6` |

Ids come from `pi --list-models gemini` and `pi --list-models claude`. Newer ids (for example `claude-sonnet-5-5`, `gemini-3.5-flash`) exist; edit the list to change the pair.

## Authentication

Host:

- Run `/login` in pi and pick the provider. The credential is saved in pi's `auth.json` (keep it private, never commit it).
- Or export an environment variable: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`. Claude also accepts `ANTHROPIC_OAUTH_TOKEN`.

Docker:

- `auth.json` is not mounted in the container, so `/login` credentials from the host are not available.
- Put the keys in `.env` (copy `.env.example`); compose passes them as environment variables.
- Anthropic subscription (OAuth) authentication may bill paid extra usage; pi warns about this (`warnings.anthropicExtraUsage`). Prefer an API key in CI.

## Switching models

- Command line: `--provider anthropic --model claude-haiku-4-5`, or `--model anthropic/claude-haiku-4-5`. Add `:high` etc. for the thinking level.
- Limit the cycle for one run: `--models "google/gemini-2.5-flash,anthropic/claude-haiku-4-5"`.
- In the TUI: `/model` opens the selector, Ctrl+P cycles the scoped models, `/scoped-models` edits the scope.

## Verified examples

Run from the repo root (pi built from `pi-harness-src`; `< /dev/null` closes stdin for non-interactive runs):

```sh
pi --provider google --model gemini-2.5-flash -p --no-session "Reply with the single word: pong" < /dev/null
pi --provider anthropic --model claude-haiku-4-5 -p --no-session "Reply with the single word: pong" < /dev/null
```

Both returned `pong` on the host. The Anthropic run used the host's `auth.json` OAuth entry; it has not been run inside the container.
