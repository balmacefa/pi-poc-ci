// Registers the cve_* tools with pi (typebox schemas); the logic lives in actions.ts.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  cveBranch,
  cveCommitPush,
  cveDetails,
  cvePriorFixes,
  cveReport,
  cveScan,
  realIo,
  type Io,
} from "./actions.ts";
import { decide, parseMode } from "./policy.ts";

/** Registers the six cve_* tools. Each re-checks the mode policy so it is safe even if the tool_call hook is bypassed. */
export function registerCveTools(pi: ExtensionAPI, makeIo: (cwd: string) => Io = realIo) {
  const tool = <P extends ReturnType<typeof Type.Object>>(
    name: string,
    description: string,
    parameters: P,
    run: (params: any, io: Io) => Promise<unknown> | unknown,
  ) =>
    pi.registerTool({
      name,
      label: name,
      description,
      parameters,
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const mode = parseMode(pi.getFlag("cve-mode"));
        const decision = decide(mode, name, params as Record<string, unknown>);
        if (decision.block) return reply({ error: decision.reason });
        try {
          return reply(await run(params, makeIo(ctx.cwd)));
        } catch (err) {
          return reply({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

  tool(
    "cve_scan",
    "Scan pinned npm dependencies in <path>/package.json against OSV and list vulnerability ids per package.",
    Type.Object({ path: Type.Optional(Type.String({ description: "Project dir, default targets/vuln-app" })) }),
    (p, io) => cveScan(p.path ?? "targets/vuln-app", io),
  );
  tool(
    "cve_details",
    "Fetch an advisory from OSV by CVE-, GHSA- or OSV id: aliases, severity, affected ranges, fixed versions, references. Saves raw JSON to reports/cve/<id>.json.",
    Type.Object({ id: Type.String() }),
    (p, io) => cveDetails(p.id, io),
  );
  tool(
    "cve_prior_fixes",
    "Search git history for earlier commits matching a pattern (default CVE-) and show their files and truncated diffs.",
    Type.Object({
      pattern: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      repo: Type.Optional(Type.String({ description: "Path under the project, or the CVE_REFERENCE_REPO path" })),
    }),
    (p, io) => cvePriorFixes(p, io),
  );
  tool(
    "cve_report",
    "Write a markdown report to reports/cve/<id>.md.",
    Type.Object({ id: Type.String(), markdown: Type.String() }),
    (p, io) => cveReport(p.id, p.markdown, io),
  );
  tool(
    "cve_branch",
    "Patch mode only: create or switch to branch cve/<id>.",
    Type.Object({ id: Type.String() }),
    (p, io) => cveBranch(p.id, io),
  );
  tool(
    "cve_commit_push",
    "Patch mode only: commit targets/ and reports/ on cve/<id> and push to origin. Push errors are returned as text.",
    Type.Object({ id: Type.String(), message: Type.String() }),
    (p, io) => cveCommitPush(p.id, p.message, io),
  );
}

function reply(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}
