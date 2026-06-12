// Siri4EU news Worker.
//
// scheduled handler (cron, every 5 min): runs the aggregation pipeline, writes
// the result to KV under the key "latest".
// fetch handler (HTTP): GET /news.json reads "latest" from KV and serves it
// with CORS headers locked to env.ALLOWED_ORIGIN. OPTIONS is handled for
// browser preflight.

import { buildSnapshot } from './aggregator.js';
import { isNewsApiEnabled } from './newsapi.js';

const KV_KEY = 'latest';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

async function writeSnapshot(env) {
  const snapshot = await buildSnapshot(env);
  const payload = {
    ...snapshot,
    meta: {
      newsApiEnabled: isNewsApiEnabled(env),
      generatedAt: new Date().toISOString(),
    },
  };
  await env.NEWS_KV.put(KV_KEY, JSON.stringify(payload));
  return payload;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      writeSnapshot(env)
        .then((p) => console.log(`[scheduled] wrote ${p.articles.length} articles`))
        .catch((err) => console.error('[scheduled] failed:', err.stack || err.message)),
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders(env),
      });
    }

    if (url.pathname === '/' || url.pathname === '/news.json') {
      let body = await env.NEWS_KV.get(KV_KEY);

      // Cold KV (first deploy before any cron fired, or local dev): build on
      // demand so a fresh dev environment isn't empty. Cheap enough — same
      // path the cron uses.
      if (!body) {
        const payload = await writeSnapshot(env);
        body = JSON.stringify(payload);
      }

      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders(env),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders(env) });
  },
};
