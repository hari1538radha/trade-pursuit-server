// Economic calendar from the free Forex Factory weekly export.
// The feed asks clients not to poll more than a couple of times every 5 minutes,
// so results are cached in memory and shared by every user.
const FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
};
const TTL = 30 * 60 * 1000;
const cache = new Map(); // week -> { at, events }

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
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'TradePursuit/1.0' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Feed answered ${res.status}`);
    const events = normalize(await res.json());
    cache.set(week, { at: Date.now(), events });
    return { events, updatedAt: new Date().toISOString(), cached: false };
  } catch (err) {
    // Serve stale data rather than nothing if the feed is rate limiting us.
    if (hit) return { events: hit.events, updatedAt: new Date(hit.at).toISOString(), cached: true, stale: true };
    throw Object.assign(new Error('News feed is unavailable right now, try again in a few minutes'), { status: 502, cause: err });
  }
}

export const _resetNewsCache = () => cache.clear();
