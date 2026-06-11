// Keyword relevance filter: keep articles about Siri (the new "Siri AI" /
// Siri 3.0) AND an EU / DMA / regulatory angle. This is deliberately scoped to
// Siri itself — broader "Apple Intelligence" coverage is out of scope.
// Word-boundary regexes avoid false hits like "feud" (eu).

const SIRI_TERMS = [
  /\bsiri\b/i,
];

const EU_TERMS = [
  /\beu\b/i,
  /\beurope/i, // europe, european, europeans, europe's
  /\bdma\b/i,
  /\bdigital markets act\b/i,
  /\bbrussels\b/i,
  /\beuropean commission\b/i,
];

// Coarse topic buckets used by the frontend nav pills. An article can fall in
// both — these are views, not exclusive categories. (Every relevant article
// mentions Siri, so the product bucket keys off the availability/rollout angle
// rather than the word "Siri" itself.)
const POLICY_TERMS = [
  /\bdma\b/i,
  /\bdigital markets act\b/i,
  /\beuropean commission\b/i,
  /\bbrussels\b/i,
  /\bregulat/i,
  /\bantitrust\b/i,
  /\bgatekeeper\b/i,
  /\bcomply|compliance\b/i,
  /\bfine[sd]?\b/i,
];

const PRODUCT_TERMS = [
  /\brollout\b/i,
  /\blaunch/i,
  /\bdelay/i,
  /\bavailab/i,
  /\brelease/i,
  /\bfeature/i,
  /\bredesign/i,
  /\brevamp/i,
  /\biphone/i,
  /\bios\b/i,
  /\bsiri 3/i,
];

function articleText(article) {
  return `${article.title || ''} ${article.snippet || ''}`;
}

export function isRelevant(article) {
  const text = articleText(article);
  const hasSiri = SIRI_TERMS.some((re) => re.test(text));
  const hasEU = EU_TERMS.some((re) => re.test(text));
  return hasSiri && hasEU;
}

export function topicsFor(article) {
  const text = articleText(article);
  const topics = [];
  if (POLICY_TERMS.some((re) => re.test(text))) topics.push('policy');
  if (PRODUCT_TERMS.some((re) => re.test(text))) topics.push('siri');
  return topics;
}

export function filterRelevant(articles) {
  return articles
    .filter(isRelevant)
    .map((a) => ({ ...a, topics: topicsFor(a) }));
}
