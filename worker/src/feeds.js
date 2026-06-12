// Fetches and parses RSS/Atom feeds in the Workers runtime, normalizing every
// item into the same shape the Node version produced.
//
// Node version used `rss-parser`, which pulls in Buffer/http; here we use the
// Workers-native `fetch` plus `fast-xml-parser`. The normalization (title /
// link / source / snippet / publishedAt) is hand-rolled to match the old
// output exactly so the filter, dedupe, and frontend code stays untouched.

import { XMLParser } from 'fast-xml-parser';

const DEFAULT_FRESH_DAYS = 60;
const FETCH_TIMEOUT_MS = 12000;

// The free Workers plan allows 10ms of CPU per invocation, and XML parsing is
// where nearly all of it goes (9to5Mac and Google News return 100 items each).
// We only ever show recent articles, so cap how much XML reaches the parser.
const MAX_ITEMS_PER_FEED = 25;
const MAX_SNIPPET_HTML = 4000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false, // keep everything as strings; we coerce ourselves
  parseAttributeValue: false,
  textNodeName: '#text',
  removeNSPrefix: false,
});

// FEEDS list is identical to the Node version; only the recency window is
// parameterized so `MAX_AGE_DAYS` can flow through from the env binding.
export function buildFeeds(freshDays = DEFAULT_FRESH_DAYS) {
  return [
    { name: '9to5Mac', url: 'https://9to5mac.com/feed/' },
    { name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss' },
    {
      name: 'Google News',
      url: `https://news.google.com/rss/search?q=Siri+Apple+(EU+OR+DMA+OR+%22Digital+Markets+Act%22)+when:${freshDays}d&hl=en-US&gl=US&ceid=US:en`,
      aggregator: true,
    },
    {
      name: 'Google News',
      url: `https://news.google.com/rss/search?q=Siri+(Europe+OR+EU)+(delay+OR+available+OR+rollout+OR+launch)+when:${freshDays}d&hl=en-US&gl=US&ceid=US:en`,
      aggregator: true,
    },
  ];
}

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

function splitGoogleTitle(rawTitle = '') {
  const idx = rawTitle.lastIndexOf(' - ');
  if (idx === -1) return { title: rawTitle.trim(), source: null };
  return {
    title: rawTitle.slice(0, idx).trim(),
    source: rawTitle.slice(idx + 3).trim() || null,
  };
}

// Cut the raw XML down to the first `maxItems` items/entries before parsing.
// indexOf scans are native and cost microseconds; parsing is what costs
// milliseconds, so trimming input here is the whole CPU win. Feeds are
// newest-first, so dropping the tail only loses old items.
export function truncateXmlItems(xml, maxItems = MAX_ITEMS_PER_FEED) {
  const modes = [
    { tag: '</item>', root: '<rss', close: '</channel></rss>' },
    { tag: '</entry>', root: '<feed', close: '</feed>' },
  ];
  for (const { tag, root, close } of modes) {
    if (!xml.includes(root)) continue;
    let idx = -1;
    let count = 0;
    while (count < maxItems) {
      const next = xml.indexOf(tag, idx + 1);
      if (next === -1) break;
      idx = next;
      count += 1;
    }
    if (count === 0) continue;
    if (xml.indexOf(tag, idx + 1) === -1) return xml; // already short enough
    return xml.slice(0, idx + tag.length) + close;
  }
  return xml;
}

// Some fields come back as either a string OR an object with `#text` (when the
// element had attributes). Normalize to a plain string.
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (typeof v['#text'] === 'string') return v['#text'];
    if (Array.isArray(v) && v.length) return textOf(v[0]);
  }
  return String(v);
}

// Atom: <link href="..." rel="alternate"/>. RSS: <link>https://...</link>.
// Some Atom feeds list multiple <link> elements; prefer rel="alternate".
function extractLink(item) {
  const raw = item.link;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const alt = raw.find((l) => l['@_rel'] === 'alternate') || raw[0];
    return extractLink({ link: alt });
  }
  if (typeof raw === 'object') {
    if (raw['@_href']) return String(raw['@_href']).trim();
    if (raw['#text']) return String(raw['#text']).trim();
  }
  return '';
}

// Google News items carry <source url="...">Publisher</source>. Pull the
// publisher name out, handling both string-only and attributed forms.
function extractSourceTag(item) {
  const src = item.source;
  if (!src) return null;
  if (typeof src === 'string') return src.trim() || null;
  if (typeof src === 'object') {
    if (typeof src['#text'] === 'string' && src['#text'].trim()) return src['#text'].trim();
  }
  return null;
}

function resolveSource(item, feed) {
  if (!feed.aggregator) return feed.name;
  return extractSourceTag(item);
}

function normalizeItem(item, feed) {
  const aggregator = Boolean(feed.aggregator);
  const rawTitle = textOf(item.title);
  const parsedTitle = aggregator ? splitGoogleTitle(rawTitle) : null;
  const title = (parsedTitle?.title || rawTitle).trim();
  const source = resolveSource(item, feed) || parsedTitle?.source || feed.name;

  const rawSnippet =
    textOf(item['content:encoded']) ||
    textOf(item.description) ||
    textOf(item.summary) ||
    textOf(item.content) ||
    '';
  // Full-content feeds put entire posts here; cleanText's regex passes over
  // tens of KB per item add up against the CPU limit. The snippet shows at
  // most 280 chars, so a few KB of source HTML is plenty.
  let snippet = truncate(cleanText(rawSnippet.slice(0, MAX_SNIPPET_HTML)));
  if (aggregator) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ns = norm(snippet);
    const nt = norm(title);
    if (!ns || ns.startsWith(nt) || nt.startsWith(ns)) snippet = '';
  }

  const link = extractLink(item) || textOf(item.guid);

  // RSS uses pubDate (RFC 822); Atom uses published/updated (ISO 8601).
  // `new Date(...)` parses both.
  const rawDate =
    textOf(item.pubDate) || textOf(item.published) || textOf(item.updated) || null;
  let publishedAt = null;
  if (rawDate) {
    const t = Date.parse(rawDate);
    if (!Number.isNaN(t)) publishedAt = new Date(t).toISOString();
  }

  return { title, link, source, snippet, publishedAt };
}

function extractItems(parsed) {
  // RSS 2.0
  if (parsed?.rss?.channel) {
    const ch = parsed.rss.channel;
    const items = ch.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }
  // Atom
  if (parsed?.feed?.entry) {
    const entries = parsed.feed.entry;
    return Array.isArray(entries) ? entries : [entries];
  }
  // RDF (RSS 1.0) — rare but cheap to support.
  if (parsed?.['rdf:RDF']?.item) {
    const items = parsed['rdf:RDF'].item;
    return Array.isArray(items) ? items : [items];
  }
  return [];
}

export async function fetchFeed(feed, maxItems = MAX_ITEMS_PER_FEED) {
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Siri4EU-Tracker/1.0 (+https://github.com/tommfr38/sirivseu)',
        Accept: 'application/rss+xml, application/xml, text/xml; q=0.9, */*; q=0.8',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = xmlParser.parse(truncateXmlItems(xml, maxItems));
    const rawItems = extractItems(parsed);
    const items = rawItems
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

export async function fetchAllFeeds(feeds, maxItems = MAX_ITEMS_PER_FEED) {
  return Promise.all(feeds.map((feed) => fetchFeed(feed, maxItems)));
}
