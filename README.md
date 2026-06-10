# Siri4EU Tracker

A small web app that aggregates the latest news about **Siri AI's availability in the European Union** — the ongoing Apple vs. EU **Digital Markets Act (DMA)** dispute.

It pulls from reputable tech RSS feeds (9to5Mac, MacRumors, The Verge, Apple Newsroom) plus topic-scoped Google News queries (which surface Reuters, Bloomberg, FT, and others), filters to articles about **Siri (the new "Siri AI" / Siri 3.0) + the EU / DMA**, de-duplicates, and presents them newest-first in a clean, dark, editorial UI.

> **Copyright note:** the app only ever shows a **headline, the publisher's own feed summary, the publish date, and a link** to the original article. It never scrapes or reproduces full article bodies.

---

## Features

- **Server-side feed fetching** (no browser CORS headaches) via a small Express backend.
- **RSS + optional NewsAPI.org** — works fully on RSS alone; plug in a key for broader coverage.
- **Keyword relevance filter** — keeps articles mentioning Siri **and** an EU / DMA / regulatory angle (word-boundary matching to avoid false positives). Scoped to Siri itself, not broader Apple Intelligence coverage.
- **De-duplication** across feeds (same story via a publisher and Google News collapses to one card).
- **Recency window** — only shows coverage from the last `MAX_AGE_DAYS` days (default 60), so older Siri/EU news cycles (e.g. the 2024 Apple Intelligence delay) don't resurface alongside the current Siri 3.0 dispute.
- **Newest-first sort** with human "3h ago" timestamps.
- **Caching with background refresh** — feeds are polled on a sensible interval (15 min default), not on every page load.
- **Graceful degradation** — if one feed is down, the rest still render; the stats bar shows how many feeds are live.
- **Filters & search** — pill nav (All / DMA & Policy / Siri & AI) plus a headline search box.
- **Dark, mobile-first, responsive** design with a serif display headline and pink→purple→blue gradient.

---

## Quick start

Requires **Node.js 18+** (uses the built-in `fetch`; developed on Node 22).

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

That's the whole setup — no database, no build step, no API key required.

### Other commands

```bash
npm run feeds   # Stage-1 sanity check: fetch + filter feeds, print to the console
npm run dev     # start with auto-restart on file changes (node --watch)
```

---

## Adding a NewsAPI.org key (optional)

The app runs on RSS by default. To broaden coverage with [NewsAPI.org](https://newsapi.org):

1. Register for a free key at <https://newsapi.org/register>.
2. Copy the example env file and add your key:

   ```bash
   cp .env.example .env
   ```

   ```ini
   # .env
   NEWSAPI_KEY=your_key_here
   ```

3. Restart the server (`npm start`).

On boot the console prints `NewsAPI: enabled`, and NewsAPI results are merged into the same filter/de-dupe/sort pipeline. If the key is missing, invalid, or rate-limited, the app **silently falls back to RSS-only** — it never crashes on a bad key.

Other optional env vars (see `.env.example`): `PORT` (default `3000`), `CACHE_TTL_MS` (default `900000`, i.e. 15 min), and `MAX_AGE_DAYS` (default `60`).

---

## Deploy to GitHub Pages

GitHub Pages serves **static files only** — it can't run the Express backend. So for Pages, a GitHub Action runs the aggregator on a schedule, bakes the result into `public/news.json`, and publishes the static site. The frontend fetches `news.json` — the *same* code path works locally, where the Express server answers that URL with live data instead.

This is already wired up in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): it rebuilds on every push to `main`, on a **30-minute cron**, and on manual trigger.

**One-time setup:**

1. Create an empty repo on GitHub (no README/license), e.g. `siri4eu-tracker`.
2. Push this folder to it:

   ```bash
   git init -b main
   git add .
   git commit -m "Siri4EU Tracker"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

3. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **“GitHub Actions”**.
4. The workflow runs automatically (watch the **Actions** tab). When it finishes, your site is live at:

   ```
   https://<you>.github.io/<repo>/
   ```

**Refresh cadence:** the published site updates each time the cron runs (every 30 min — edit the `cron:` line to change it). You can also trigger a rebuild anytime from the Actions tab → **Run workflow**.

**Optional NewsAPI on Pages:** add your key under **Settings → Secrets and variables → Actions → New repository secret**, named `NEWSAPI_KEY`. To change the time window, add a repository **variable** named `MAX_AGE_DAYS`.

> Note: GitHub disables scheduled workflows after 60 days of repo inactivity; any push re-enables them. On a **public** repo, Actions minutes are unlimited (free).

---

## How it works

The build went in three stages — you can inspect each independently:

1. **Feeds → console.** `src/feeds.js` fetches and normalizes RSS; `npm run feeds` prints the filtered results so you can see the pipeline working with zero UI.
2. **API layer.** `server.js` exposes the cached aggregator over JSON.
3. **Frontend.** `public/` renders that JSON into the styled UI.

### Pipeline

```
RSS feeds ─┐
           ├─▶ fetch (parallel, fault-tolerant) ─▶ filter (keywords)
NewsAPI* ──┘                                          │
                                                      ▼
            sort (newest-first) ◀── de-dupe (title + link) ◀──┘
                                                      │
                                                      ▼
                                cache (15 min, stale-while-revalidate)
                                                      │
                                                      ▼
                                  GET /api/news  ─▶  frontend
```
*NewsAPI is only included when `NEWSAPI_KEY` is set.

### API

| Endpoint           | Description                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `GET /api/news`    | Filtered, de-duped, newest-first articles + stats + per-feed status.  |
| `GET /api/news?refresh=1` | Force a fresh fetch, bypassing the cache.                      |
| `GET /api/health`  | Liveness + whether NewsAPI is enabled.                                 |

`GET /api/news` returns:

```jsonc
{
  "articles": [
    {
      "title": "EU rejects Apple's DMA exemption for Siri AI",
      "link":  "https://…",
      "source": "Reuters",
      "snippet": "The European Commission said …",
      "publishedAt": "2026-06-10T15:21:53.000Z",
      "topics": ["policy", "siri"]
    }
  ],
  "stats": { "total": 112, "sources": 77, "feedsOk": 6, "feedsTotal": 6 },
  "feeds": [ { "name": "9to5Mac", "ok": true, "count": 100, "error": null } ],
  "fetchedAt": "2026-06-10T19:40:00.000Z",
  "meta": { "newsApiEnabled": false, "cacheTtlMs": 900000 }
}
```

---

## Project layout

```
siri4eu/
├── server.js              # Express app: static frontend + JSON API
├── src/
│   ├── feeds.js           # RSS sources, fetch + normalize (fault-tolerant)
│   ├── newsapi.js         # optional NewsAPI.org integration
│   ├── filter.js          # keyword relevance + topic tagging
│   ├── dedupe.js          # cross-feed de-duplication
│   └── aggregator.js      # orchestration + cache + background refresh
├── scripts/
│   ├── fetch-console.js   # Stage-1 console demo (`npm run feeds`)
│   └── build-static.js    # bakes public/news.json for GitHub Pages
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js             # rendering, filters, search, refresh
├── .github/workflows/
│   └── deploy.yml         # GitHub Pages build + deploy (push / cron / manual)
├── .env.example
└── README.md
```

---

## Customizing

- **Add / change feeds** — edit the `FEEDS` array in `src/feeds.js`. Mark broad aggregator feeds (like Google News) with `aggregator: true` so the per-article publisher is used as the source.
- **Tune relevance** — adjust the keyword regexes in `src/filter.js`.
- **Change refresh cadence** — set `CACHE_TTL_MS`.
- **Change the time window** — set `MAX_AGE_DAYS` (also bounds the Google News `when:` query).

---

## Notes & limitations

- Reuters discontinued its public RSS feeds, so its coverage (and other wires) comes in through topic-scoped Google News queries rather than a direct feed.
- Google News links are redirect URLs that resolve to the original publisher; they open in a new tab.
- Relevance is keyword-based and intentionally simple — it favors recall, so an occasional tangential article can slip through.

## License

MIT
