// Build one snapshot: fetch all sources in parallel → filter → recency cutoff
// → dedupe → sort newest-first. Output shape matches the Node version exactly
// so the frontend doesn't need to know the backend changed.
//
// No in-memory cache here — the Worker is invoked once per cron tick, writes
// the snapshot to KV, and exits. KV is the cache.

import { buildFeeds, fetchAllFeeds } from './feeds.js';
import { fetchNewsApi } from './newsapi.js';
import { filterRelevant } from './filter.js';
import { dedupe } from './dedupe.js';

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

  const [feedResults, newsApiResult] = await Promise.all([
    fetchAllFeeds(feeds),
    fetchNewsApi(env),
  ]);

  const sources = [...feedResults, newsApiResult];

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
