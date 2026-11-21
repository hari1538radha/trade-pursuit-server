// Economic calendar from the free Forex Factory weekly export.
// The feed asks clients not to poll more than a couple of times every 5 minutes,
// so results are cached in memory and shared by every user.
const FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
};
const TTL = 30 * 60 * 1000;
const cache = new Map(); // week -> { at, events }
const failures = new Map(); // week -> { at, reason }: back off after a failure
const BACKOFF = 2 * 60 * 1000;

const IMPACTS = { High: 'high', Medium: 'medium', Low: 'low', Holiday: 'holiday', 'Non-Economic': 'none' };

/** Turn the raw feed rows into the shape the client renders. */
export function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((e) => e && e.title && e.date && !Number.isNaN(Date.parse(e.date)))
    .map((e) => {
      const date = new Date(e.date).toISOString();
      const currency = String(e.country || '').toUpperCase();
      return {
        id: `${currency}-${date}-${e.title}`.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 120),
        title: String(e.title),
        currency,
        date,
        impact: IMPACTS[e.impact] || 'none',
        forecast: e.forecast || '',
        previous: e.previous || '',
        actual: e.actual || '',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getNews(week = 'thisweek', fetchImpl = fetch) {
  const url = FEEDS[week];
  if (!url) throw Object.assign(new Error('Unknown week'), { status: 400 });
  const hit = cache.get(week);
  if (hit && Date.now() - hit.at < TTL) return { events: hit.events, updatedAt: new Date(hit.at).toISOString(), cached: true };
  const failed = failures.get(week);
  if (failed && Date.now() - failed.at < BACKOFF) {
    if (hit) return { events: hit.events, updatedAt: new Date(hit.at).toISOString(), cached: true, stale: true };
    throw Object.assign(new Error('News feed is unavailable right now, try again in a few minutes'), { status: 502, reason: `${failed.reason} (retrying after a short pause)` });
  }
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json,text/plain,*/*', 'User-Agent': 'Mozilla/5.0 (compatible; TradePursuit/1.0)' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`feed answered HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
    const text = await res.text();
    let rows;
    try { rows = JSON.parse(text); } catch { throw new Error(`feed did not return JSON (starts with: ${text.slice(0, 60).replace(/\s+/g, ' ')})`); }
    const events = normalize(rows);
    cache.set(week, { at: Date.now(), events });
    failures.delete(week);
    return { events, updatedAt: new Date().toISOString(), cached: false };
  } catch (err) {
    // Serve stale data rather than nothing if the feed is rate limiting us.
    console.error(`[news] ${week}: ${err.message}`);
    failures.set(week, { at: Date.now(), reason: err.message });
    if (hit) return { events: hit.events, updatedAt: new Date(hit.at).toISOString(), cached: true, stale: true };
    throw Object.assign(new Error('News feed is unavailable right now, try again in a few minutes'), { status: 502, reason: err.message });
  }
}

export const _resetNewsCache = () => { cache.clear(); failures.clear(); };
