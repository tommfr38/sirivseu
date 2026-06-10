// Stage 1 sanity check: fetch + filter feeds and print to the console.
// Run with `npm run feeds`. No server, no frontend — just proves the
// fetch → filter → dedupe → sort pipeline works against live feeds.

import 'dotenv/config';
import { fetchAllFeeds, FEEDS } from '../src/feeds.js';
import { fetchNewsApi, isNewsApiEnabled } from '../src/newsapi.js';
import { filterRelevant } from '../src/filter.js';
import { dedupe } from '../src/dedupe.js';

function timeAgo(iso) {
  if (!iso) return 'unknown';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function main() {
  console.log('Fetching feeds…\n');
  console.log(`NewsAPI: ${isNewsApiEnabled() ? 'enabled' : 'disabled (RSS only)'}\n`);

  const [feedResults, newsApi] = await Promise.all([fetchAllFeeds(FEEDS), fetchNewsApi()]);
  const sources = [...feedResults, newsApi];

  console.log('Per-source results:');
  for (const s of sources) {
    if (s.enabled === false) {
      console.log(`  • ${s.name}: skipped (no key)`);
      continue;
    }
    const status = s.ok ? `ok, ${s.items.length} items` : `FAILED — ${s.error}`;
    console.log(`  • ${s.name}: ${status}`);
  }

  const raw = sources.flatMap((s) => s.items || []);
  const relevant = filterRelevant(raw);
  const unique = dedupe(relevant).sort(
    (a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0),
  );

  console.log(`\nFetched ${raw.length} total → ${relevant.length} relevant → ${unique.length} after de-dupe.\n`);
  console.log('Latest matching articles:\n');

  for (const a of unique.slice(0, 20)) {
    console.log(`[${a.source}] ${a.title}`);
    console.log(`  ${timeAgo(a.publishedAt)}  ·  ${a.link}`);
    if (a.snippet) console.log(`  ${a.snippet.slice(0, 140)}${a.snippet.length > 140 ? '…' : ''}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
