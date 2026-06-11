// De-duplicate articles that surface across multiple feeds.
//
// The same story often appears via a publisher's own feed AND Google News
// (with a redirect link), so matching purely on URL isn't enough. We key on a
// normalized title and, separately, on a normalized link. First write wins —
// callers order direct publisher feeds before aggregators so the cleaner,
// non-redirect entry is the one we keep.

function normalizeTitle(title = '') {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeLink(link = '') {
  try {
    const url = new URL(link);
    return (url.hostname + url.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return link.toLowerCase();
  }
}

export function dedupe(articles) {
  const seenTitles = new Set();
  const seenLinks = new Set();
  const out = [];

  for (const article of articles) {
    const titleKey = normalizeTitle(article.title);
    const linkKey = normalizeLink(article.link);
    if (titleKey && seenTitles.has(titleKey)) continue;
    if (linkKey && seenLinks.has(linkKey)) continue;
    if (titleKey) seenTitles.add(titleKey);
    if (linkKey) seenLinks.add(linkKey);
    out.push(article);
  }

  return out;
}
