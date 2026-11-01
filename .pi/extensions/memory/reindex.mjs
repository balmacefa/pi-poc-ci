#!/usr/bin/env node
/**
 * Standalone reindex CLI (for cron / manual runs, independent of a pi session).
 *   node reindex.mjs          incremental
 *   node reindex.mjs --force   full rebuild
 */
import { reindex } from "./indexer.ts";
import { stats } from "./store.ts";

const force = process.argv.includes("--force");
const r = reindex(force);
console.log(`reindex (${force ? "full" : "incremental"}):`, r);
console.log("stats:", stats());
