// ============================================================================
// NEWS DESK X READER: write-ups shared on X about the cashtags the reader picked.
//
// One recent search a run, for posts that carry one of those cashtags and link
// to a write-up, leaving out reposts and replies:
//   ($AAA OR $BBB) (url:"substack.com" OR url:"seekingalpha.com/article" OR ...) -is:retweet -is:reply
// The linked write-up becomes a News Desk item (writeup: true), or, when the
// desk already has that article, gains an xShares entry: { id, at } of the post
// that shared it (shown as a link to the post).
//
// Money: X bills each post a search returns (about half a cent on pay-per-use;
// X_PRICE_PER_POST overrides it). So a run asks only for posts newer than the
// last one it saw (since_id) and never for more than the money left: the
// month's cap (monthlyUsd, default $10) spread evenly over the days left in the
// month, so a quiet day's allowance rolls forward but the month cannot go over.
// A search returns at least 10 posts, so a run is skipped when fewer than 10
// fit. No user objects are requested, since X bills those separately. The
// spending limit set in the X developer console stays the hard backstop.
//
// Settings:
//   X_BEARER_TOKEN in .env (gitignored; passed in as token)
//   news-x.json at the repo root (gitignored, written by hand):
//     { "cashtags": ["AAA", "BBB"], "monthlyUsd": 10, "hosts"?: [...] }
// State: news-x-state.json at the repo root (gitignored): since_id, spend by
// month and day, posts read, the last run and error.
// No token or no cashtags: the reader is off and says so in the feed health.
// ============================================================================
import path from 'node:path'
import { cleanUrl, idForUrl, plain, siteInfo } from './feeds.js'
import { readJsonSafe, writeJsonAtomic } from './store.js'
import { localDay } from './budget.js'

const API = 'https://api.x.com/2/tweets/search/recent'
const DEFAULT_PRICE = 0.005          // $ per post returned (X pay-per-use, 2026)
const MIN_RESULTS = 10               // X's floor for max_results
const MAX_PAGES = 3                  // per run
const FIRST_LOOKBACK_H = 48          // the first run, with no since_id, looks back this far
const SHARES_KEEP = 20
// Where write-ups live. Each becomes one url: clause (quoted, as X's docs show for
// addresses with punctuation); a link is kept only when it matches one of these.
export const WRITEUP_HOSTS = ['substack.com', 'seekingalpha.com/article', 'medium.com', 'beehiiv.com', 'x.com/i/article']

const CASHTAG = /^[A-Z][A-Z0-9.]{0,9}$/
const monthOf = day => day.slice(0, 7)
const daysInMonth = day => new Date(+day.slice(0, 4), +day.slice(5, 7), 0).getDate()
const round4 = v => Math.round(v * 1e4) / 1e4

// The search query for the configured cashtags and write-up hosts (X caps self-serve
// recent-search queries at 512 characters).
export function buildQuery(cashtags, hosts = WRITEUP_HOSTS) {
  const tags = cashtags.map(c => `$${c}`)
  const urls = hosts.map(h => `url:"${h}"`)
  const q = `(${tags.join(' OR ')}) (${urls.join(' OR ')}) -is:retweet -is:reply`
  if (q.length > 512) throw new Error(`the X query is ${q.length} characters, over X's 512`)
  return q
}

// A link that points at a write-up on one of the hosts, or null
export function writeupLink(u, hosts = WRITEUP_HOSTS) {
  let x
  try { x = new URL(u) } catch { return null }
  const host = x.hostname.toLowerCase().replace(/^www\./, '')
  const where = `${host}${x.pathname}`.toLowerCase()
  return hosts.some(h => (h.includes('/') ? where.startsWith(h) || where.includes(`.${h}`) : host === h || host.endsWith(`.${h}`))) ? u : null
}

// A readable title from an address when X gives none: the last path part with its
// id and dashes removed ("4953767-nvidia-the-buyback" → "Nvidia The Buyback")
export function titleFromUrl(u) {
  try {
    const last = new URL(u).pathname.split('/').filter(Boolean).pop() || ''
    const words = decodeURIComponent(last).replace(/^\d+-/, '').replace(/[-_]+/g, ' ').trim()
    return words.length >= 8 ? words.replace(/\b\w/g, c => c.toUpperCase()) : null
  } catch { return null }
}

// The outlet label for a write-up link
function outletOf(u) {
  const info = siteInfo(u)
  if (info) return info.outlet
  const host = (() => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } })()
  if (host.endsWith('.substack.com')) return `Substack (${host.split('.')[0]})`
  if (host === 'substack.com') return 'Substack'
  if (host === 'medium.com' || host.endsWith('.medium.com')) return 'Medium'
  if (host.endsWith('beehiiv.com')) return 'beehiiv'
  if (host === 'x.com') return 'X article'
  return host || 'X'
}

// Posts → items: one per write-up link (the post's own text, links removed, is the dek)
export function itemsFromPosts(posts, { cashtags, hosts = WRITEUP_HOSTS, fetched = new Date().toISOString() } = {}) {
  const want = new Set(cashtags)
  const out = new Map()
  for (const p of posts || []) {
    if (!p?.id) continue
    const tags = [...new Set([
      ...(p.entities?.cashtags || []).map(c => String(c.tag || '').toUpperCase()),
      ...[...String(p.text || '').matchAll(/\$([A-Za-z][A-Za-z0-9.]{0,9})\b/g)].map(m => m[1].toUpperCase()),
    ])].filter(t => want.has(t))
    const said = plain(String(p.text || '').replace(/https?:\/\/t\.co\/\S+/g, ' ')).trim()
    for (const e of p.entities?.urls || []) {
      const link = writeupLink(e.unwound_url || e.expanded_url || '', hosts) || writeupLink(e.expanded_url || '', hosts)
      if (!link) continue
      const id = idForUrl(link)
      const share = { id: String(p.id), at: p.created_at || fetched }
      const prev = out.get(id)
      if (prev) { prev.xShares.push(share); prev.tickers = [...new Set([...prev.tickers, ...tags])]; continue }
      const title = plain(e.title || '') || titleFromUrl(link) || (said ? said.slice(0, 140) : null)
      if (!title) continue
      out.set(id, {
        id, url: cleanUrl(link), title, dek: plain(e.description || '') || (said ? `Shared on X: ${said.slice(0, 280)}` : null),
        source: 'X', outlet: outletOf(link), section: 'Shared on X',
        published: p.created_at || fetched, fetched, kind: 'article', paywalled: /seekingalpha\.com\/article\//i.test(link),
        tickers: tags, writeup: true, xShares: [share],
      })
    }
  }
  return [...out.values()]
}

// Union of two share lists, newest first, capped
export function mergeShares(a = [], b = []) {
  const byId = new Map()
  for (const s of [...(a || []), ...(b || [])]) if (s?.id && !byId.has(s.id)) byId.set(s.id, s)
  return [...byId.values()].sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, SHARES_KEEP)
}

export function createXReader({ dir, token = '', UA, fetchImpl = fetch, price } = {}) {
  const CONFIG_FILE = path.join(dir, 'news-x.json')
  const STATE_FILE = path.join(dir, 'news-x-state.json')
  const perPost = Number(price ?? process.env.X_PRICE_PER_POST) > 0 ? Number(price ?? process.env.X_PRICE_PER_POST) : DEFAULT_PRICE
  const scrub = s => (token ? String(s).split(token).join('***') : String(s))

  const config = () => {
    const r = readJsonSafe(CONFIG_FILE)
    const c = r.state === 'ok' && r.data && typeof r.data === 'object' ? r.data : {}
    const cashtags = [...new Set((Array.isArray(c.cashtags) ? c.cashtags : []).map(s => String(s).replace(/^\$/, '').trim().toUpperCase()).filter(s => CASHTAG.test(s)))]
    const monthlyUsd = Number(c.monthlyUsd) > 0 ? Number(c.monthlyUsd) : 10
    const hosts = Array.isArray(c.hosts) && c.hosts.length ? c.hosts.map(String) : WRITEUP_HOSTS
    return { cashtags, monthlyUsd, hosts, problem: r.state === 'corrupt' || r.state === 'error' ? `news-x.json could not be read (${r.error})` : null }
  }
  const loadState = () => {
    const r = readJsonSafe(STATE_FILE)
    return r.state === 'ok' && r.data && typeof r.data === 'object' ? r.data : { months: {}, days: {}, posts: 0 }
  }
  const saveState = s => { try { writeJsonAtomic(STATE_FILE, s, { pretty: true }) } catch (e) { console.warn(`News desk X: state not saved: ${e.message}`) } }

  // spend so far this month and today, and what today may still spend
  function allowance(s, monthlyUsd, day = localDay()) {
    const month = monthOf(day)
    const monthSpent = s.months?.[month]?.spent || 0
    const daySpent = s.days?.[day]?.spent || 0
    const daysLeft = daysInMonth(day) - +day.slice(8, 10) + 1
    const forToday = Math.max(0, monthlyUsd - (monthSpent - daySpent)) / daysLeft
    return { month, day, monthSpent, daySpent, today: Math.max(0, Math.min(forToday - daySpent, monthlyUsd - monthSpent)) }
  }
  function spend(s, usd, posts, day) {
    const month = monthOf(day)
    s.months ||= {}; s.days ||= {}
    s.months[month] = { spent: round4((s.months[month]?.spent || 0) + usd), posts: (s.months[month]?.posts || 0) + posts }
    s.days[day] = { spent: round4((s.days[day]?.spent || 0) + usd), posts: (s.days[day]?.posts || 0) + posts }
    for (const d of Object.keys(s.days).sort().slice(0, -62)) delete s.days[d]
    s.posts = (s.posts || 0) + posts
  }

  let fieldsParam = 'tweet.fields'
  async function search(params) {
    const u = new URL(API)
    for (const [k, v] of Object.entries({ ...params, [fieldsParam]: 'created_at,entities' })) if (v != null) u.searchParams.set(k, String(v))
    let r
    try { r = await fetchImpl(u, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA || 'econ-dashboard', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }) }
    catch (e) { throw new Error(e?.name === 'TimeoutError' ? 'X timed out' : 'X could not be reached') }
    let j = null
    try { j = await r.json() } catch { /* not JSON */ }
    if (r.ok) return j || {}
    const why = scrub(j?.detail || j?.title || j?.errors?.[0]?.message || j?.error || `HTTP ${r.status}`)
    // the field list's name changed in X's newer docs (post.fields); switch once, free (no posts returned)
    if (r.status === 400 && fieldsParam === 'tweet.fields' && /tweet\.fields|post\.fields/i.test(why)) { fieldsParam = 'post.fields'; return search(params) }
    const err = new Error(r.status === 401 ? 'X rejected the token (401): check X_BEARER_TOKEN in .env'
      : r.status === 403 ? `X refused the search (403): the app's plan may not include reads (${why})`
      : r.status === 402 || r.status === 429 ? `X stopped the search (${r.status}): out of credits, over the spending limit or rate-limited (${why})`
      : `X answered ${r.status}: ${why}`)
    err.status = r.status
    err.why = why
    throw err
  }

  return {
    enabled: () => Boolean(token) && config().cashtags.length > 0,
    status() {
      const c = config(), s = loadState(), a = allowance(s, c.monthlyUsd)
      return { on: Boolean(token) && c.cashtags.length > 0, cashtags: c.cashtags, monthlyUsd: c.monthlyUsd, monthSpent: round4(a.monthSpent), todayLeft: round4(a.today), perPost, posts: s.posts || 0, lastRun: s.lastRun || null, lastError: s.lastError || null }
    },
    // one run: { items, health }; never throws
    async read() {
      const c = config()
      const s = loadState(), day = localDay()
      const a = allowance(s, c.monthlyUsd, day)
      const label = `X write-ups${c.cashtags.length ? ` (${c.cashtags.map(t => `$${t}`).join(', ')})` : ''} · $${a.monthSpent.toFixed(2)} of $${c.monthlyUsd} this month`
      const h = { feed: label, source: 'X', ok: false, count: 0, latest: null }
      if (c.problem) return { items: [], health: { ...h, error: c.problem } }
      if (!token) return { items: [], health: { ...h, error: 'off: add X_BEARER_TOKEN to .env' } }
      if (!c.cashtags.length) return { items: [], health: { ...h, error: 'off: list the cashtags in news-x.json' } }
      const fits = Math.floor(a.today / perPost + 1e-9)
      if (fits < MIN_RESULTS) return { items: [], health: { ...h, ok: true, skipped: true, error: `paused: today's share of the $${c.monthlyUsd} month is used ($${a.daySpent.toFixed(2)} spent today)` } }

      const query = buildQuery(c.cashtags, c.hosts)
      const posts = []
      let budgetLeft = a.today, next = null, newest = null, pages = 0, spentRun = 0, retried = false
      try {
        while (pages < MAX_PAGES) {
          const max = Math.min(100, Math.floor(budgetLeft / perPost + 1e-9))
          if (max < MIN_RESULTS) break
          const params = { query, max_results: max, ...(next ? { next_token: next } : {}) }
          if (s.sinceId) params.since_id = s.sinceId
          else params.start_time = new Date(Date.now() - FIRST_LOOKBACK_H * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
          let j
          try { j = await search(params) } catch (e) {
            // a since_id older than search's seven days is refused: start again once from a recent window
            if (!retried && e.status === 400 && /since_id/i.test(e.why || '') && s.sinceId) { delete s.sinceId; retried = true; continue }
            throw e
          }
          const got = Array.isArray(j.data) ? j.data : []
          const usd = got.length * perPost
          spend(s, usd, got.length, day)
          spentRun += usd; budgetLeft -= usd
          posts.push(...got)
          if (!newest && j.meta?.newest_id) newest = j.meta.newest_id
          next = j.meta?.next_token || null
          pages++
          if (!next) break
        }
        if (newest) s.sinceId = newest
        s.lastRun = new Date().toISOString()
        delete s.lastError
        saveState(s)
      } catch (e) {
        s.lastError = scrub(e.message)
        s.lastRun = new Date().toISOString()
        saveState(s)
        return { items: [], health: { ...h, error: s.lastError } }
      }
      const items = itemsFromPosts(posts, { cashtags: c.cashtags, hosts: c.hosts })
      const latest = posts.length ? posts.map(p => p.created_at).filter(Boolean).sort().pop() || null : null
      const after = allowance(s, c.monthlyUsd, day)
      return {
        items,
        health: {
          ...h, feed: `X write-ups (${c.cashtags.map(t => `$${t}`).join(', ')}) · $${after.monthSpent.toFixed(2)} of $${c.monthlyUsd} this month`,
          ok: true, count: items.length, latest, posts: posts.length, usd: round4(spentRun),
          ...(next ? { error: `more posts were waiting; stopped at ${pages} page${pages === 1 ? '' : 's'} to stay inside today's allowance` } : {}),
        },
      }
    },
  }
}

// Fold a run's X items into the feed items: an article the run or the store already
// has gains the share (and the post's cashtags) without its title, summary or source
// being replaced by the post's; a new one is added as a write-up shared on X.
export function attachShares(feedItems, xItems, stored = () => null) {
  const byId = new Map(feedItems.map(i => [i.id, i]))
  const extra = []
  for (const x of xItems) {
    const run = byId.get(x.id)
    if (run) {
      run.xShares = mergeShares(run.xShares, x.xShares)
      run.tickers = [...new Set([...(run.tickers || []), ...x.tickers])]
      continue
    }
    const old = stored(x.id)
    if (old) extra.push({ id: x.id, xShares: x.xShares, tickers: x.tickers, fetched: x.fetched })
    else extra.push(x)
  }
  return [...feedItems, ...extra]
}
