// OSV HTTP client with an injectable fetch, so tests never touch the network.
import type { PinnedPackage } from "./deps.ts";
import { normalizeAdvisoryId } from "./ids.ts";
import { buildBatchPayload, parseBatchResponse, type ScanResult } from "./osv.ts";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const OSV_BASE = "https://api.osv.dev/v1";

/** Queries OSV for all packages in one batch call. */
export async function queryBatch(packages: PinnedPackage[], fetchFn: FetchLike): Promise<ScanResult[]> {
  if (packages.length === 0) return [];
  const res = await fetchFn(`${OSV_BASE}/querybatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildBatchPayload(packages)),
  });
  if (!res.ok) throw new Error(`OSV querybatch failed with HTTP ${res.status}`);
  return parseBatchResponse(packages, await res.json());
}

/** Fetches one raw vulnerability record; the id is validated before it is placed in the URL. */
export async function fetchVuln(rawId: string, fetchFn: FetchLike): Promise<{ id: string; raw: unknown }> {
  const id = normalizeAdvisoryId(rawId);
  if (id === undefined) throw new Error(`invalid advisory id: ${JSON.stringify(rawId)}`);
  const res = await fetchFn(`${OSV_BASE}/vulns/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`OSV vulns/${id} failed with HTTP ${res.status}`);
  return { id, raw: await res.json() };
}
