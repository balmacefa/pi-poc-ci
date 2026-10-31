---
name: ci-triage
description: Triage a failing CI job. Use when given a CI log, a failing test, or asked why a build or pipeline failed.
---

# CI triage

1. Find the first error in the log, not the last. Later errors are usually consequences.
2. Classify it: `code` (a bug in this repo), `test` (a wrong or flaky test), `infra` (network, runner, credentials) or `config`.
3. For `code` or `test`, locate the file with `grep` and read it before proposing a fix.
4. Always output exactly these three lines, then the VERDICT line (FAIL, since a failure was triaged):
   `class: <class>`
   `cause: <one sentence>`
   `fix: <one sentence>`
