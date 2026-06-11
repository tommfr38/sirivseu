// Siri4EU Tracker — frontend logic.
// Pulls the Worker's /news.json, renders stats + article cards, handles pill
// filters, search, manual + periodic refresh. Articles are built via the DOM
// (textContent) so feed-supplied titles/snippets can never inject markup.

// Cloudflare Worker that aggregates feeds every 30 min and serves the result
// from KV. CORS is locked to https://tommfr38.com on the Worker side.
const NEWS_ENDPOINT = 'https://siri4eu-worker.sirivseu.workers.dev/news.json';

const state = {
  articles: [],
  stats: null,
  feeds: [],
  fetchedAt: null,
  filter: 'all',
  query: '',
};

const els = {
  feed: document.getElementById('feed'),
  placeholder: document.getElementById('placeholder'),
  statTotal: document.getElementById('stat-total'),
  statSources: document.getElementById('stat-sources'),
  barFill: document.getElementById('bar-fill'),
  barLabel: document.getElementById('bar-label'),
  pills: document.getElementById('pills'),
  search: document.getElementById('search'),
  refresh: document.getElementById('refresh'),
};

const TAG_LABELS = { policy: 'DMA & Policy', siri: 'Siri & AI' };

// --- Helpers ---------------------------------------------------------------

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function exactDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// --- Rendering -------------------------------------------------------------

function renderStats() {
  const { stats, fetchedAt } = state;
  if (!stats) return;
  els.statTotal.textContent = stats.total;
  els.statSources.textContent = stats.sources;

  const ratio = stats.feedsTotal ? stats.feedsOk / stats.feedsTotal : 0;
  els.barFill.style.width = `${Math.round(ratio * 100)}%`;
  const updated = fetchedAt ? ` · updated ${timeAgo(fetchedAt)}` : '';
  els.barLabel.textContent = `${stats.feedsOk} of ${stats.feedsTotal} feeds live${updated}`;
}

function matchesFilter(article) {
  if (state.filter !== 'all' && !(article.topics || []).includes(state.filter)) {
    return false;
  }
  if (state.query) {
    const hay = `${article.title} ${article.snippet} ${article.source}`.toLowerCase();
    if (!hay.includes(state.query)) return false;
  }
  return true;
}

function articleCard(article) {
  const card = el('article', 'card article');

  const head = el('div', 'article-head');
  head.append(el('span', 'source', article.source || 'Unknown'));
  if (article.publishedAt) {
    head.append(el('span', 'dot', '·'));
    const time = el('time', null, timeAgo(article.publishedAt));
    time.dateTime = article.publishedAt;
    time.title = exactDate(article.publishedAt);
    head.append(time);
  }
  card.append(head);

  const h2 = el('h2', 'headline');
  const link = el('a', null, article.title);
  link.href = article.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  h2.append(link);
  card.append(h2);

  if (article.snippet) card.append(el('p', 'snippet', article.snippet));

  const foot = el('div', 'article-foot');
  const tags = el('div', 'tags');
  for (const topic of article.topics || []) {
    if (TAG_LABELS[topic]) tags.append(el('span', `tag ${topic}`, TAG_LABELS[topic]));
  }
  foot.append(tags);

  const read = el('a', 'read', `Read on ${article.source || 'source'} ↗`);
  read.href = article.link;
  read.target = '_blank';
  read.rel = 'noopener noreferrer';
  foot.append(read);

  card.append(foot);
  return card;
}

function renderFeed() {
  const visible = state.articles.filter(matchesFilter);
  els.feed.replaceChildren();

  if (!state.articles.length) {
    els.feed.append(el('div', 'empty', 'No coverage loaded yet. Try refreshing.'));
    return;
  }
  if (!visible.length) {
    els.feed.append(
      el('div', 'empty', 'No articles match this filter. Try “All coverage” or clear the search.'),
    );
    return;
  }
  const frag = document.createDocumentFragment();
  for (const article of visible) frag.append(articleCard(article));
  els.feed.append(frag);
}

function render() {
  renderStats();
  renderFeed();
}

// --- Data ------------------------------------------------------------------

async function load({ force = false } = {}) {
  try {
    // Worker returns the latest cron-built KV snapshot. `force` bypasses any
    // browser/CDN cache but the Worker itself has no on-demand rebuild — the
    // freshest data is whatever the last 30-min cron tick produced.
    const params = new URLSearchParams({ t: Date.now() });
    const res = await fetch(`${NEWS_ENDPOINT}?${params}`, {
      cache: force ? 'no-store' : 'default',
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    state.articles = data.articles || [];
    state.stats = data.stats || null;
    state.feeds = data.feeds || [];
    state.fetchedAt = data.fetchedAt || null;
    render();
  } catch (err) {
    console.error('Failed to load news:', err);
    if (!state.articles.length) {
      els.feed.replaceChildren(
        el('div', 'error', `Couldn't reach the news service. ${err.message}`),
      );
    }
  }
}

// --- Events ----------------------------------------------------------------

els.pills.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  state.filter = pill.dataset.filter;
  for (const p of els.pills.querySelectorAll('.pill')) {
    p.classList.toggle('is-active', p === pill);
  }
  renderFeed();
});

let searchTimer;
els.search.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value.trim().toLowerCase();
  searchTimer = setTimeout(() => {
    state.query = value;
    renderFeed();
  }, 120);
});

els.refresh.addEventListener('click', async () => {
  els.refresh.classList.add('is-busy');
  els.refresh.disabled = true;
  await load({ force: true });
  els.refresh.classList.remove('is-busy');
  els.refresh.disabled = false;
});

// Keep "x ago" labels honest while the tab stays open.
setInterval(renderStats, 60000);
setInterval(() => {
  // Re-render cards every minute so relative times advance, without refetching.
  if (state.articles.length) renderFeed();
}, 60000);

// Pull fresh data periodically (server cache means this is cheap).
setInterval(() => load(), 5 * 60000);

load();
