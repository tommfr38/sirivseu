// Optional NewsAPI.org integration for broader coverage.
//
// Entirely opt-in: if NEWSAPI_KEY isn't set we return nothing and the app runs
// on RSS alone. Uses the global fetch built into Node 18+.

const ENDPOINT = 'https://newsapi.org/v2/everything';

// Query mirrors the RSS focus: Siri (the new "Siri AI") + an EU/DMA angle.
const QUERY = 'Siri AND (EU OR DMA OR "Digital Markets Act" OR Europe)';

export function isNewsApiEnabled() {
  return Boolean(process.env.NEWSAPI_KEY);
}

// Returns normalized articles (same shape as the RSS layer) or [] on any
// problem / when disabled. Never throws.
export async function fetchNewsApi() {
  const apiKey = process.env.NEWSAPI_KEY;
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
