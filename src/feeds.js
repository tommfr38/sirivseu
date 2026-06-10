// Fetches and parses RSS feeds, normalizing every item into a common shape.
//
// Reuters dropped its public RSS feeds years ago, so reputable wire/policy
// coverage is pulled in via topic-scoped Google News RSS queries instead. Those
// are marked `aggregator: true` so we read the real publisher from each item.

import Parser from 'rss-parser';

// Only surface recent coverage. Google News supports a `when:` recency operator
// (cuts old results at the source); the aggregator enforces the same window as
// the authoritative cutoff. Older Siri/EU cycles (e.g. the 2024 Apple
// Intelligence delay) are filtered out this way.
const FRESH_DAYS = Number(process.env.MAX_AGE_DAYS) || 60;

const parser = new Parser({
  timeout: 12000,
  headers: {
    // A descriptive UA keeps a few feeds (e.g. Apple) from rejecting the request.
    'User-Agent': 'Siri4EU-Tracker/1.0 (+https://github.com/siri4eu-tracker)',
    Accept: 'application/rss+xml, application/xml, text/xml; q=0.9, */*; q=0.8',
  },
  customFields: {
    item: [['source', 'sourceTag']],
  },
});

// Each entry: { name, url, aggregator? }
// `aggregator` feeds carry items from many publishers (we trust the per-item
// source over the feed name).
export const FEEDS = [
  { name: '9to5Mac', url: 'https://9to5mac.com/feed/' },
  { name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss' },
  // Topic-scoped Google News queries — broad, reputable coverage incl. Reuters,
  // FT, Bloomberg, etc. The filter layer narrows these down further.
  {
    name: 'Google News',
    url: `https://news.google.com/rss/search?q=Siri+Apple+(EU+OR+DMA+OR+%22Digital+Markets+Act%22)+when:${FRESH_DAYS}d&hl=en-US&gl=US&ceid=US:en`,
    aggregator: true,
  },
  {
    name: 'Google News',
    url: `https://news.google.com/rss/search?q=Siri+(Europe+OR+EU)+(delay+OR+available+OR+rollout+OR+launch)+when:${FRESH_DAYS}d&hl=en-US&gl=US&ceid=US:en`,
    aggregator: true,
  },
];

// Strip HTML tags / decode a handful of entities / collapse whitespace so feed
// summaries render cleanly. We only ever touch the feed-provided snippet here —
// never full article bodies.
export function cleanText(input = '') {
  return String(input)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max = 280) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// Google News titles look like "Headline - Publisher". Split off the publisher
// so the title is clean and we have a source fallback.
function splitGoogleTitle(rawTitle = '') {
  const idx = rawTitle.lastIndexOf(' - ');
  if (idx === -1) return { title: rawTitle.trim(), source: null };
  return {
    title: rawTitle.slice(0, idx).trim(),
    source: rawTitle.slice(idx + 3).trim() || null,
  };
}

function resolveSource(item, feed) {
  if (!feed.aggregator) return feed.name;
  // rss-parser maps <source>Name</source> to sourceTag (string or {_, $}).
  const tag = item.sourceTag;
  if (typeof tag === 'string' && tag.trim()) return tag.trim();
  if (tag && typeof tag === 'object' && tag._) return String(tag._).trim();
  return null; // fall back to publisher parsed from the title
}

function normalizeItem(item, feed) {
  const aggregator = Boolean(feed.aggregator);
  const parsedTitle = aggregator ? splitGoogleTitle(item.title || '') : null;
  const title = (parsedTitle?.title || item.title || '').trim();
  const source = resolveSource(item, feed) || parsedTitle?.source || feed.name;

  const rawSnippet = item.contentSnippet || item.content || item.summary || '';
  let snippet = truncate(cleanText(rawSnippet));
  // Google News descriptions are usually just the headline (with the publisher
  // appended) or a link list — redundant noise. Drop a snippet that's
  // effectively the same text as the title.
  if (aggregator) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ns = norm(snippet);
    const nt = norm(title);
    if (!ns || ns.startsWith(nt) || nt.startsWith(ns)) snippet = '';
  }

  const link = (item.link || item.guid || '').trim();
  const published = item.isoDate || item.pubDate || null;

  return {
    title,
    link,
    source,
    snippet,
    publishedAt: published ? new Date(published).toISOString() : null,
  };
}

// Fetch + parse one feed. Never throws — failures are returned as
// { ok: false, error } so one dead source can't take down the rest.
export async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const items = (parsed.items || [])
      .map((item) => normalizeItem(item, feed))
      .filter((a) => a.title && a.link);
    return { name: feed.name, url: feed.url, ok: true, items };
  } catch (error) {
    return {
      name: feed.name,
      url: feed.url,
      ok: false,
      items: [],
      error: error.message || String(error),
    };
  }
}

// Fetch every configured feed in parallel.
export async function fetchAllFeeds(feeds = FEEDS) {
  return Promise.all(feeds.map(fetchFeed));
}
