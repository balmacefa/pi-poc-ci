// OSV HTTP client with an injectable fetch, so tests never touch the network.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PinnedPackage } from "./deps.ts";
import { normalizeAdvisoryId } from "./ids.ts";
import { buildBatchPayload, parseBatchResponse, type ScanResult } from "./osv.ts";

const FIXTURES_DIR = "fixtures/osv";

type CacheMode = "live" | "record" | "replay" | "offline";

function getCacheMode(): CacheMode {
  const mode = process.env.PI_OSV_MODE?.toLowerCase();
  if (mode === "offline") return "replay";
  if (mode === "record" || mode === "replay") return mode;
  return "live";
}

function cacheKey(url: string, body?: string): string {
  const data = `${url}|${body || ""}`;
  return crypto.createHash("sha1").update(data).digest("hex");
}

function createCachingFetch(fetchFn: FetchLike): FetchLike {
  const mode = getCacheMode();
  if (mode === "live") return fetchFn;

  return async (url, init) => {
    const key = cacheKey(url, init?.body);
    const fixturePath = path.join(FIXTURES_DIR, `${key}.json`);

    if (mode === "replay") {
      if (!fs.existsSync(fixturePath)) {
        throw new Error(`OSV cache miss: ${fixturePath} not found (mode=replay)`);
      }
      const cached = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
      return {
        ok: cached.ok,
        status: cached.status,
        json: async () => cached.body,
      };
    }

    // mode === "record"
    const res = await fetchFn(url, init);
    const body = await res.json();
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({ ok: res.ok, status: res.status, body }, null, 2),
    );
    return {
      ok: res.ok,
      status: res.status,
      json: async () => body,
    };
  };
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const OSV_BASE = "https://api.osv.dev/v1";

/** Queries OSV for all packages in one batch call. */
export async function queryBatch(packages: PinnedPackage[], fetchFn: FetchLike): Promise<ScanResult[]> {
  if (packages.length === 0) return [];
  const cachedFetch = createCachingFetch(fetchFn);
  const res = await cachedFetch(`${OSV_BASE}/querybatch`, {
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
  const cachedFetch = createCachingFetch(fetchFn);
  const res = await cachedFetch(`${OSV_BASE}/vulns/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`OSV vulns/${id} failed with HTTP ${res.status}`);
  return { id, raw: await res.json() };
}
