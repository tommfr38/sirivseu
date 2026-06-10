// Orchestration + cache: fetch all sources → filter → dedupe → sort newest-first.
//
// Caching strategy is stale-while-revalidate:
//   • fresh cache  → served immediately
//   • stale cache  → served immediately, refresh kicked off in the background
//   • cold (no data) → caller awaits the first fetch
// A background interval also keeps the cache warm so the first real visitor
// rarely waits. Net effect: feeds are hit on a sensible cadence, not per-load.

import { fetchAllFeeds, FEEDS } from './feeds.js';
import { fetchNewsApi } from './newsapi.js';
import { filterRelevant } from './filter.js';
import { dedupe } from './dedupe.js';

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 15 * 60 * 1000; // 15 min
// Only keep coverage from the last N days. This is what separates the current
// Siri 3.0 / EU dispute from the older 2024 Siri-in-EU news cycle that search
// feeds can resurface. Authoritative — applied regardless of source.
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS) || 60;

let cache = null; // { articles, stats, feeds, fetchedAt }
let inFlight = null;

function sortNewestFirst(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}

export async function buildSnapshot() {
  // RSS feeds + (optional) NewsAPI, all in parallel. Direct publisher feeds are
  // listed before aggregators so dedupe keeps the cleaner entry.
  const [feedResults, newsApiResult] = await Promise.all([
    fetchAllFeeds(FEEDS),
    fetchNewsApi(),
  ]);

  const sources = [...feedResults, newsApiResult];

  const rawArticles = sources.flatMap((s) => s.items || []);
  const relevant = filterRelevant(rawArticles);
  // Drop anything older than the window (and undated items we can't date-check).
  const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const recent = relevant.filter(
    (a) => a.publishedAt && Date.parse(a.publishedAt) >= cutoffMs,
  );
  const unique = dedupe(recent);
  const articles = sortNewestFirst(unique);

  const distinctSources = new Set(articles.map((a) => a.source)).size;
  // Count only sources that actually contribute (NewsAPI when disabled doesn't).
  const reporting = sources.filter((s) => s.enabled !== false);
  const feedsOk = reporting.filter((s) => s.ok).length;

  return {
    articles,
    stats: {
      total: articles.length,
      sources: distinctSources,
      feedsOk,
      feedsTotal: reporting.length,
    },
    feeds: sources.map((s) => ({
      name: s.name,
      ok: s.ok,
      enabled: s.enabled !== false,
      count: (s.items || []).length,
      error: s.error || null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

async function refresh() {
  const snapshot = await buildSnapshot();
  cache = snapshot;
  return snapshot;
}

function isFresh() {
  if (!cache) return false;
  return Date.now() - Date.parse(cache.fetchedAt) < CACHE_TTL_MS;
}

// Public accessor used by the API route.
export async function getNews({ force = false } = {}) {
  if (cache && isFresh() && !force) return cache;

  // Coalesce concurrent refreshes into one feed fetch.
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }

  // Have stale data? Serve it now; the background refresh updates the next read.
  if (cache && !force) return cache;

  // Cold start (or forced): wait for the fetch.
  return inFlight;
}

// Warm the cache on boot and on a fixed interval. Returns the interval handle.
export function startBackgroundRefresh() {
  refresh().catch((err) => console.error('[aggregator] initial refresh failed:', err.message));
  const handle = setInterval(() => {
    refresh().catch((err) => console.error('[aggregator] refresh failed:', err.message));
  }, CACHE_TTL_MS);
  handle.unref?.(); // don't keep the process alive just for refreshes
  return handle;
}

export { CACHE_TTL_MS, MAX_AGE_DAYS };
