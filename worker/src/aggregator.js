// Build one snapshot: fetch sources → filter → recency cutoff → dedupe →
// sort newest-first. Output shape matches the Node version exactly so the
// frontend doesn't need to know the backend changed.
//
// CPU budget: the free Workers plan allows ~10ms per invocation and XML
// parsing is where nearly all of it goes. Instead of parsing every feed every
// tick, each 5-minute tick gives ONE feed a full live fetch (rotating through
// the list, so each feed refreshes every ~30 min) and serves the rest from the
// per-feed KV cache, which stores already-parsed items. This keeps per-tick
// parse cost to a single feed while letting every feed contribute up to
// MAX_ITEMS_SOLO items.
//
// The same cache doubles as a "last good copy" fallback: Google News
// intermittently 503s requests coming from Cloudflare's IPs, and without a
// fallback one bad fetch would replace the whole snapshot with a near-empty
// one. Cached items stand in for up to MAX_STALE_MS.

import { buildFeeds, fetchAllFeeds } from './feeds.js';
import { fetchNewsApi } from './newsapi.js';
import { filterRelevant } from './filter.js';
import { dedupe } from './dedupe.js';

const FEED_CACHE_KEY = 'feed-cache';
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
const ROTATION_INTERVAL_MS = 5 * 60 * 1000; // must match the cron schedule

// Item cap for the one rotating live fetch vs. the cap used when several
// feeds must be fetched in the same tick (cold cache after a deploy) — the
// combined parse still has to fit the CPU budget.
const MAX_ITEMS_SOLO = 100;
const MAX_ITEMS_SHARED = 25;

async function loadFeedCache(env) {
  if (!env?.NEWS_KV) return {};
  try {
    return JSON.parse((await env.NEWS_KV.get(FEED_CACHE_KEY)) || '{}');
  } catch {
    return {};
  }
}

function sortNewestFirst(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}

export async function buildSnapshot(env) {
  const maxAgeDays = Number(env?.MAX_AGE_DAYS) || 60;
  const feeds = buildFeeds(maxAgeDays);
  const now = Date.now();
  const cache = await loadFeedCache(env);

  const cachedEntry = (feed) => {
    const hit = cache[feed.url];
    return hit && now - hit.at <= MAX_STALE_MS ? hit : null;
  };

  // This tick's rotation slot gets a live fetch; so does any feed with no
  // usable cache entry (first run, or entry older than MAX_STALE_MS).
  const slot = Math.floor(now / ROTATION_INTERVAL_MS) % feeds.length;
  const liveFeeds = feeds.filter((feed, i) => i === slot || !cachedEntry(feed));
  const maxItems = liveFeeds.length <= 1 ? MAX_ITEMS_SOLO : MAX_ITEMS_SHARED;

  const [liveResults, newsApiResult] = await Promise.all([
    fetchAllFeeds(liveFeeds, maxItems),
    fetchNewsApi(env),
  ]);
  const liveByUrl = new Map(liveResults.map((r) => [r.url, r]));

  const nextCache = {};
  const feedSources = feeds.map((feed) => {
    const live = liveByUrl.get(feed.url);
    if (live?.ok) {
      nextCache[feed.url] = { items: live.items, at: now };
      return live;
    }
    const hit = cachedEntry(feed);
    if (hit) {
      nextCache[feed.url] = hit;
      return {
        name: feed.name,
        url: feed.url,
        // ok means "has data": rotation cache hits and failure fallbacks both
        // serve real items, so they shouldn't drag the "N feeds live" stat
        // down. A failed live fetch still surfaces in `error`.
        ok: true,
        items: hit.items,
        error: live
          ? `${live.error} (cached copy from ${new Date(hit.at).toISOString()})`
          : null,
      };
    }
    return live; // fetch failed and nothing cached — report the failure as-is
  });

  if (env?.NEWS_KV) {
    await env.NEWS_KV.put(FEED_CACHE_KEY, JSON.stringify(nextCache));
  }

  const sources = [...feedSources, newsApiResult];

  const rawArticles = sources.flatMap((s) => s.items || []);
  const relevant = filterRelevant(rawArticles);
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const recent = relevant.filter(
    (a) => a.publishedAt && Date.parse(a.publishedAt) >= cutoffMs,
  );
  const unique = dedupe(recent);
  const articles = sortNewestFirst(unique);

  const distinctSources = new Set(articles.map((a) => a.source)).size;
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
