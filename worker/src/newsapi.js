// Optional NewsAPI.org integration. Disabled when NEWSAPI_KEY is unset (which
// is the default — broader coverage is opt-in).

const ENDPOINT = 'https://newsapi.org/v2/everything';
const QUERY = 'Siri AND (EU OR DMA OR "Digital Markets Act" OR Europe)';

export function isNewsApiEnabled(env) {
  return Boolean(env?.NEWSAPI_KEY);
}

export async function fetchNewsApi(env) {
  const apiKey = env?.NEWSAPI_KEY;
  if (!apiKey) return { name: 'NewsAPI', ok: true, enabled: false, items: [] };

  const params = new URLSearchParams({
    q: QUERY,
    language: 'en',
    sortBy: 'publishedAt',
    pageSize: '50',
  });

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { 'X-Api-Key': apiKey, 'User-Agent': 'Siri4EU-Tracker/1.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `NewsAPI responded ${res.status}`);
    }

    const data = await res.json();
    const items = (data.articles || [])
      .map((a) => ({
        title: (a.title || '').trim(),
        link: (a.url || '').trim(),
        source: a.source?.name || 'NewsAPI',
        snippet: (a.description || '').trim(),
        publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
      }))
      .filter((a) => a.title && a.link);

    return { name: 'NewsAPI', ok: true, enabled: true, items };
  } catch (error) {
    return {
      name: 'NewsAPI',
      ok: false,
      enabled: true,
      items: [],
      error: error.message || String(error),
    };
  }
}
