// Siri4EU Tracker — Express server.
// Serves the static frontend and a small JSON API over the cached aggregator.

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNews, startBackgroundRefresh, CACHE_TTL_MS, MAX_AGE_DAYS } from './src/aggregator.js';
import { isNewsApiEnabled } from './src/newsapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');

// --- API -------------------------------------------------------------------

// Main feed: filtered, de-duped, newest-first articles + stats + per-feed status.
// Served at both /api/news and /news.json — the latter is the same path the
// static GitHub Pages build produces, so the frontend uses one URL everywhere.
async function sendNews(req, res) {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const data = await getNews({ force });
    // Let browsers/proxies cache briefly; server already caches the heavy work.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      ...data,
      meta: {
        newsApiEnabled: isNewsApiEnabled(),
        cacheTtlMs: CACHE_TTL_MS,
      },
    });
  } catch (err) {
    console.error('[api] news request failed:', err);
    res.status(502).json({ error: 'Failed to load news', detail: err.message });
  }
}

app.get('/api/news', sendNews);
// Registered before express.static so it shadows any baked public/news.json
// during local dev (you always get live data locally).
app.get('/news.json', sendNews);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, newsApiEnabled: isNewsApiEnabled(), uptime: process.uptime() });
});

// --- Static frontend -------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// --- Start -----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n  Siri4EU Tracker running → http://localhost:${PORT}`);
  console.log(`  NewsAPI: ${isNewsApiEnabled() ? 'enabled' : 'disabled (RSS only)'}`);
  console.log(`  Refresh interval: ${Math.round(CACHE_TTL_MS / 60000)} min`);
  console.log(`  Recency window: last ${MAX_AGE_DAYS} days\n`);
  startBackgroundRefresh();
});
