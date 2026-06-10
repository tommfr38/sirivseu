// Static build for GitHub Pages: run the aggregation pipeline once and write the
// result to public/news.json. The deploy workflow runs this on a schedule, so
// the published snapshot is what the static frontend fetches.
//
// This is the same fetch → filter → dedupe → recency → sort pipeline the live
// server uses; it just persists the output instead of caching it in memory.

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../src/aggregator.js';
import { isNewsApiEnabled } from '../src/newsapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'public', 'news.json');

async function main() {
  console.log('Building static news snapshot…');
  const snapshot = await buildSnapshot();

  const payload = {
    ...snapshot,
    meta: {
      newsApiEnabled: isNewsApiEnabled(),
      static: true,
      generatedAt: new Date().toISOString(),
    },
  };

  await writeFile(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath}\n  ${snapshot.articles.length} articles · ${snapshot.stats.sources} sources · ${snapshot.stats.feedsOk}/${snapshot.stats.feedsTotal} feeds live`,
  );
}

main().catch((err) => {
  console.error('Static build failed:', err);
  process.exit(1);
});
