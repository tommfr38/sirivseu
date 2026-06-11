# Siri4EU Tracker

A small web app that aggregates the latest news about **Siri AI's availability in the European Union** — the ongoing Apple vs. EU **Digital Markets Act (DMA)** dispute.

It pulls from reputable tech RSS feeds (9to5Mac, MacRumors, The Verge, Apple Newsroom) plus topic-scoped Google News queries (which surface Reuters, Bloomberg, FT, and others), filters to articles about **Siri (the new "Siri AI" / Siri 3.0) + the EU / DMA**, de-duplicates, and presents them newest-first in a clean, dark, editorial UI.

> **Copyright note:** the app only ever shows a **headline, the publisher's own feed summary, the publish date, and a link** to the original article. It never scrapes or reproduces full article bodies.

Live: <https://tommfr38.com/sirivseu/>

---

## Architecture

```
   ┌───────────────────────────────┐
   │  Cloudflare Worker (cron)     │   every 30 min:
   │  fetch RSS → filter → dedupe  │   fetch all feeds in parallel,
   │  → JSON snapshot → KV         │   write snapshot to KV under "latest"
   └───────────────┬───────────────┘
                   │
   ┌───────────────▼───────────────┐
   │  Cloudflare Worker (fetch)    │   GET /news.json reads "latest" from
   │  CORS: https://tommfr38.com   │   KV, returns JSON with CORS locked
   └───────────────┬───────────────┘   to the Pages origin
                   │
   ┌───────────────▼───────────────┐
   │  GitHub Pages (static site)   │   public/ — html + css + app.js
   │  https://tommfr38.com/sirivseu│   app.js fetches the Worker on load
   └───────────────────────────────┘
```

Backend lives in [`worker/`](worker/), frontend in [`public/`](public/). The GitHub Actions workflow only deploys the static site — there's no longer a server-side build step.

---

## Repo layout

```
siri4eu/
├── public/                       # GitHub Pages site (static)
│   ├── index.html
│   ├── styles.css
│   └── app.js                    # renders, fetches the Worker on load
├── worker/                       # Cloudflare Worker (news pipeline + API)
│   ├── wrangler.toml             # name, KV binding, cron, vars
│   ├── package.json
│   └── src/
│       ├── index.js              # scheduled() + fetch() handlers
│       ├── aggregator.js         # buildSnapshot() — orchestrates the pipeline
│       ├── feeds.js              # RSS sources, fetch + parse (fast-xml-parser)
│       ├── filter.js             # keyword relevance + topic tagging
│       ├── dedupe.js             # cross-feed de-duplication
│       └── newsapi.js            # optional NewsAPI.org integration
└── .github/workflows/deploy.yml  # static Pages deploy on push to main
```

---

## Worker — local dev

Requires Node 18+ for `wrangler`.

```bash
cd worker
npm install
npx wrangler dev
# → http://localhost:8787/news.json
```

First request takes 10–15s while it fetches all feeds; subsequent requests are instant (served from the local KV emulation). To exercise the cron path locally, pass `--test-scheduled` and POST to `/__scheduled`.

## Worker — deploy

```bash
cd worker
npx wrangler deploy
```

KV namespace and account are wired through [`wrangler.toml`](worker/wrangler.toml). The Cron Trigger (`*/30 * * * *`) runs in Cloudflare and rebuilds the snapshot every 30 min.

## Worker — optional NewsAPI

To broaden coverage past RSS:

```bash
cd worker
npx wrangler secret put NEWSAPI_KEY    # paste your key when prompted
npx wrangler deploy
```

If unset, the Worker runs on RSS feeds only (which is the default).

## Worker — tuning

- **Recency window** — `MAX_AGE_DAYS` in `[vars]` of `wrangler.toml` (default 60).
- **CORS origin** — `ALLOWED_ORIGIN` in `[vars]` (default `https://tommfr38.com`). Update if you move the frontend.
- **Cron cadence** — `crons` under `[triggers]` (default every 30 min).
- **Feeds** — edit `worker/src/feeds.js`. Mark broad aggregator feeds (Google News) with `aggregator: true` so the per-article publisher is used as the source.
- **Relevance keywords** — `worker/src/filter.js`.

---

## API

`GET https://siri4eu-worker.sirivseu.workers.dev/news.json` returns:

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
  "stats": { "total": 99, "sources": 30, "feedsOk": 6, "feedsTotal": 6 },
  "feeds": [ { "name": "9to5Mac", "ok": true, "count": 100, "error": null } ],
  "fetchedAt": "2026-06-11T12:54:54.000Z",
  "meta": { "newsApiEnabled": false, "generatedAt": "2026-06-11T12:54:54.000Z" }
}
```

CORS is locked to `https://tommfr38.com`; preflight (`OPTIONS`) is handled.

---

## Notes & limitations

- Reuters discontinued its public RSS feeds, so its coverage (and other wires) comes in through topic-scoped Google News queries rather than a direct feed.
- Google News links are redirect URLs that resolve to the original publisher; they open in a new tab.
- Relevance is keyword-based and intentionally simple — it favors recall, so an occasional tangential article can slip through.

## License

MIT
