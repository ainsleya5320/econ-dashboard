// ============================================================================
// NEWS DESK FEEDS: everything the desk reads automatically, normalised to
// one Item shape (documented in index.js).
//
//   fetchAll({ UA, FMP_KEY, profile, known?, maxAgeDays = 7, secDays = 14 })
//     → { items, health: [{ feed, source, ok, count, latest, error?, cached?, skipped? }] }
//   Never throws for a feed: each failure is a health row. known(id) → the
//   stored item or null (pass id => store.get(id)): filings the store already
//   holds in full are skipped rather than read again.
//
// Sources (verified 2026-10-12):
//   WSJ        Dow Jones' new RSS host, feeds.content.dowjones.io/public/rss/.
//              The old feeds.a.dj.com host stopped updating in January 2025.
//              Headline plus a one-line description.
//   NYT        rss.nytimes.com section feeds: headline plus one or two sentences.
//   Economist  economist.com/<section>/rss.xml: headline plus the rubric (CDATA).
//              Each feed holds ~300 items going back months; the age window
//              keeps the last week.
//   FMP        /stable/news/stock?symbols=<one symbol> for each watchlist name
//              (a combined call lets the most-covered name crowd out the rest).
//              FMP's publishedDate is New York wall-clock time.
//   Seeking Alpha  write-ups only (the user wants analysis, not its news wire):
//              the public per-ticker feed, api/sa/combined/<SYMBOL>.xml, keeping
//              its /article/ items (it also carries news items, which are
//              dropped), plus the site-wide Editors' Picks. Each item is marked
//              writeup: true with its author; FMP's copies of the same articles
//              are marked too. Article pages sit behind bot protection and a
//              Premium paywall and are never fetched: clip one to read it.
//   SEC        data.sec.gov submissions for each watchlist CIK, last 14 days:
//              8-K, 6-K, 10-Q, 10-K, 20-F, 40-F, DEF 14A, Schedules 13D and 13G,
//              tender-offer schedules, and their amendments. Schedule 13D/G
//              rows are kept only when the watchlist company is the subject
//              (a bank's own 13G filings about other companies are dropped).
//              For 8-K, 6-K and 13D the main document and up to two Exhibit
//              99s are read as text (40,000 characters at most). When one of
//              those documents fails, the item carries textPartial: true and
//              is read again on every run until all of them answer.
//
// Paywalled article pages (WSJ, NYT, The Economist) are NEVER fetched: their
// subscriber terms forbid automated access. Full text reaches the desk only
// through the user's clips and through public SEC filings.
//
// Politeness: at most 2 requests at a time per host (3 for FMP; SEC hosts share
// one lane, spaced 120 ms, inside EDGAR's 10-a-second rule), timeouts on every
// request, conditional GETs, and a response cache: a feed fetched in the last
// 10 minutes is not fetched again, and concurrent runs share one. Filing
// documents are cached for the life of the process; pass known(id) (truthy
// when the store already holds that filing) to skip them across restarts.
// IDs: 16 hex characters of the SHA-1 of canonicalUrl(url), or of the SEC
// accession number. Use idForUrl() for clips so a clipped article and its feed
// copy share one ID.
// ============================================================================
import crypto from 'node:crypto'
import { shortName } from './profile.js'
import { TEXT_CAP } from './store.js'

const DAY = 864e5
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const FRESH_MS = 10 * 60e3          // a feed is not re-requested within this
const PER_FEED_MAX = 120            // items kept per feed after the age window
const DEK_MAX = 600

const DJ = 'https://feeds.content.dowjones.io/public/rss/'
const NYT = 'https://rss.nytimes.com/services/xml/rss/nyt/'
const ECO = 'https://www.economist.com/'
const wsj = (section, id) => ({ feed: `WSJ ${section}`, source: 'WSJ', outlet: 'WSJ', section, url: DJ + id })
const nyt = (section, id) => ({ feed: `NYT ${section}`, source: 'NYT', outlet: 'NYT', section, url: `${NYT}${id}.xml` })
const eco = (section, id) => ({ feed: `The Economist ${section}`, source: 'Economist', outlet: 'The Economist', section, url: `${ECO}${id}/rss.xml` })

// Probed 2026-10-12, all answering with items from the last few days. Tried and
// left out: WSJ Opinion, Lifestyle, U.S. News, Politics, Personal Finance (last
// item a day old but 31 items over 21 months); NYT World; Economist Asia, Europe,
// The world this week (a digest of the other sections). RSSEconomy is a 404.
export const RSS_FEEDS = [
  wsj('Markets', 'RSSMarketsMain'),
  wsj('Business', 'WSJcomUSBusiness'),
  wsj('Technology', 'RSSWSJD'),
  wsj('Economy', 'socialeconomyfeed'),
  wsj('World', 'RSSWorldNews'),
  nyt('Business', 'Business'),
  nyt('Economy', 'Economy'),
  nyt('Technology', 'Technology'),
  nyt('DealBook', 'DealBook'),
  nyt('Your Money', 'YourMoney'),
  nyt('Energy & Environment', 'EnergyEnvironment'),
  eco('Finance & economics', 'finance-and-economics'),
  eco('Business', 'business'),
  eco('Leaders', 'leaders'),
  eco('Briefing', 'briefing'),
  eco('United States', 'united-states'),
  eco('China', 'china'),
  eco('International', 'international'),
  eco('Science & technology', 'science-and-technology'),
]

// FMP's site field → display label and paywall flag (the subscriber sites first)
const SITES = {
  'wsj.com': ['WSJ', true], 'barrons.com': ["Barron's", true], 'nytimes.com': ['NYT', true],
  'economist.com': ['The Economist', true], 'bloomberg.com': ['Bloomberg', true], 'ft.com': ['FT', true],
  'investors.com': ['IBD', true], 'theinformation.com': ['The Information', true],
  'cnbc.com': ['CNBC', false], 'reuters.com': ['Reuters', false], 'marketwatch.com': ['MarketWatch', false],
  'forbes.com': ['Forbes', false], 'businessinsider.com': ['Insider', false], 'foxbusiness.com': ['Fox Business', false],
  'apnews.com': ['AP', false], 'finance.yahoo.com': ['Yahoo Finance', false], 'seekingalpha.com': ['Seeking Alpha', false],
  'zacks.com': ['Zacks', false], 'fool.com': ['Motley Fool', false], 'benzinga.com': ['Benzinga', false],
  '247wallst.com': ['24/7 Wall St.', false], 'investing.com': ['Investing.com', false], 'youtube.com': ['YouTube', false],
  'businesswire.com': ['Business Wire', false], 'prnewswire.com': ['PR Newswire', false], 'globenewswire.com': ['GlobeNewswire', false],
  'accesswire.com': ['Accesswire', false], 'proactiveinvestors.com': ['Proactive Investors', false], 'gurufocus.com': ['GuruFocus', false],
  'investorplace.com': ['InvestorPlace', false], 'thestreet.com': ['TheStreet', false], 'techcrunch.com': ['TechCrunch', false],
}

// The 8-K items in plain English (SEC Form 8-K General Instructions)
const ITEMS_8K = {
  '1.01': 'a material agreement', '1.02': 'end of a material agreement', '1.03': 'bankruptcy or receivership',
  '1.04': 'mine safety', '1.05': 'a material cybersecurity incident',
  '2.01': 'a completed acquisition or sale of assets', '2.02': 'results of operations', '2.03': 'new debt or other financial obligation',
  '2.04': 'an event that accelerates a debt', '2.05': 'exit or restructuring costs', '2.06': 'a material impairment',
  '3.01': 'a delisting or listing-rule notice', '3.02': 'unregistered share sales', '3.03': 'changed shareholder rights',
  '4.01': 'a change of auditor', '4.02': 'prior financial statements no longer reliable',
  '5.01': 'a change in control', '5.02': 'officer or director changes', '5.03': 'charter or bylaw changes',
  '5.04': 'a benefit-plan trading blackout', '5.05': 'code-of-ethics change or waiver', '5.06': 'change in shell-company status',
  '5.07': 'shareholder vote results', '5.08': 'director nomination deadlines',
  '7.01': 'Regulation FD disclosure', '8.01': 'other events', '9.01': 'financial statements and exhibits',
}
const SEC_FORMS = /^(8-K|6-K|10-K|10-Q|20-F|40-F|DEF 14A|SC 13D|SC 13G|SCHEDULE 13D|SCHEDULE 13G|SC TO-T|SC TO-I|SC 14D9)(\/A)?$/
const TEXT_FORMS = /^(8-K|6-K|SC 13D|SCHEDULE 13D)(\/A)?$/

// ── small helpers ───────────────────────────────────────────────────────────
const sha16 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16)
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString() : null)
const padCik = c => (c && /^\d+$/.test(String(c)) ? String(c).replace(/^0+/, '').padStart(10, '0') : null)
const cut = (s, n) => {
  if (!s || s.length <= n) return s || null
  const t = s.slice(0, n), sp = t.lastIndexOf(' ')
  return `${(sp > n * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:]+$/, '')}…`
}

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€',
  pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×', minus: '−', frac12: '½', frac14: '¼', frac34: '¾',
  laquo: '«', raquo: '»', sect: '§', para: '¶', prime: '′', shy: '', zwj: '', zwnj: '', lrm: '', rlm: '',
  thinsp: ' ', ensp: ' ', emsp: ' ', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä', ccedil: 'ç', oslash: 'ø', aring: 'å', szlig: 'ß',
}
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,8});/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m
  })
}
// HTML fragment → one line of plain text
export function plain(s) {
  return decodeEntities(String(s ?? '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/[\s ​]+/g, ' ').trim()
}
// a whole HTML document (filings) → readable text, line breaks kept, table
// cells joined with " | " so the figures stay on their row
export function htmlToText(html) {
  let s = String(html ?? '')
  // EDGAR's SGML document header (<TYPE>EX-99.1 <SEQUENCE>2 <FILENAME>...)
  s = s.replace(/<(TYPE|SEQUENCE|FILENAME|DESCRIPTION)>[^<\n]*/g, ' ')
  s = s.replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style|head|title|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|blockquote|center|pre|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  s = decodeEntities(s)
  return s.split('\n')
    .map(l => l.replace(/[ \t ​  ]+/g, ' ')
      .replace(/(\s*\|\s*)+/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '')
      .replace(/\$ \| /g, '$').replace(/ \| %/g, '%').replace(/ \| \)/g, ')').replace(/\( \| /g, '(')
      .trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── URLs and IDs ────────────────────────────────────────────────────────────
const TRACKING = /^(utm_.*|mod|cid|smid|smtyp|partner|ref|referrer|refsrc|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ncid|cmpid|cmp|guccounter|guce_.*|siteid|yptr|taid|soc_src|soc_trk|sr_share|tpcc|ito|mbid|ocid|xtor|_hsenc|_hsmi|mkt_tok|igshid|s_cid|campaign_id|emc|gaa_.*|sref|ftag|link_source|rss|feedtype|feedname|dicbo|traffic_source|ns_campaign|ns_mchannel|ns_source|ns_linkname|ns_fee|at_medium|at_campaign|wt\.mc_id|cmpgn|reflink|in_source|st|share|shared|user_id|regi_id|segment_id|instance_id|unlocked_article_code)$/i
// Subscriber news sites whose article addresses need no query at all: every
// parameter goes, so a clip opened from a newsletter (which carries the
// reader's subscriber ids) matches its feed copy and stores no ids.
const NO_QUERY_HOSTS = /(^|\.)(wsj\.com|barrons\.com|nytimes\.com|economist\.com|seekingalpha\.com)$/
// The address to show and link to: https, tracking parameters and fragment removed.
export function cleanUrl(raw) {
  let u
  try { u = new URL(String(raw ?? '').trim()) } catch { return String(raw ?? '').trim() || null }
  if (!/^https?:$/.test(u.protocol)) return u.href
  u.protocol = 'https:'
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  const keep = NO_QUERY_HOSTS.test(u.hostname) ? []
    : [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b))
  u.search = keep.length ? `?${new URLSearchParams(keep)}` : ''
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
  return u.href
}
// The form two copies of one article reduce to (also drops www., so an FMP
// link and the outlet's own feed link agree).
export function canonicalUrl(raw) {
  const c = cleanUrl(raw)
  try { const u = new URL(c); u.hostname = u.hostname.replace(/^www\./, ''); return u.href } catch { return c }
}
export const idForUrl = url => sha16(canonicalUrl(url))
export const idForAccession = adsh => sha16(String(adsh).trim())
const siteOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }
// A known site's display label and paywall flag ({ outlet, paywalled }), or
// null. Clips use it so a clipped page is labelled the way its feed copy is.
export function siteInfo(url) {
  const host = siteOf(url)
  const hit = SITES[host] || SITES[host.split('.').slice(-2).join('.')]
  return hit ? { outlet: hit[0], paywalled: hit[1] } : null
}

// ── polite fetching ─────────────────────────────────────────────────────────
const LANE_CFG = { 'sec.gov': { max: 2, gap: 120 }, 'financialmodelingprep.com': { max: 3, gap: 0 }, 'seekingalpha.com': { max: 2, gap: 250 } }
const lanes = new Map()
const laneKey = host => (/(^|\.)sec\.gov$/.test(host) ? 'sec.gov' : host)
function pump(l, cfg) {
  while (l.active < cfg.max && l.queue.length) {
    l.active++
    const go = l.queue.shift(), now = Date.now(), at = Math.max(now, l.next)
    l.next = at + cfg.gap
    if (at > now) setTimeout(go, at - now); else go()
  }
}
async function inLane(url, fn) {
  const key = laneKey(new URL(url).hostname)
  const cfg = LANE_CFG[key] || { max: 2, gap: 0 }
  let l = lanes.get(key)
  if (!l) lanes.set(key, (l = { active: 0, queue: [], next: 0 }))
  await new Promise(res => { l.queue.push(res); pump(l, cfg) })
  try { return await fn() } finally { l.active--; pump(l, cfg) }
}

const responses = new Map()          // cache key → { at, body, etag, lastModified }
const RESPONSES_MAX = 300
function remember(key, entry) {
  responses.delete(key); responses.set(key, entry)
  while (responses.size > RESPONSES_MAX) responses.delete(responses.keys().next().value)
}
// GET text with the cache, conditional requests and one retry on 429/5xx.
// `key` names the request without any API key; error messages never carry the URL.
// keep: false for one-off documents (filings), whose derived text is cached instead
async function getText(url, { UA, key = url, freshMs = FRESH_MS, timeout = 20e3, accept = '*/*', retries = 1, keep = true } = {}) {
  const hit = responses.get(key)
  if (hit && Date.now() - hit.at < freshMs) return { body: hit.body, cached: true }
  const headers = { 'User-Agent': UA || BROWSER_UA, Accept: accept }
  if (hit?.etag) headers['If-None-Match'] = hit.etag
  if (hit?.lastModified) headers['If-Modified-Since'] = hit.lastModified
  for (let a = 0; ; a++) {
    let res
    try {
      res = await inLane(url, async () => {
        const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeout) })
        return { status: r.status, etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified'), body: r.ok ? await r.text() : '' }
      })
    } catch (e) {
      const why = e?.name === 'TimeoutError' ? `timed out after ${Math.round(timeout / 1000)} s` : (e?.cause?.code || 'network error')
      if (a < retries) { await new Promise(r => setTimeout(r, 1500 * (a + 1))); continue }
      throw new Error(why)
    }
    if (res.status === 304 && hit) { remember(key, { ...hit, at: Date.now() }); return { body: hit.body, cached: true } }
    if (res.status >= 200 && res.status < 300) {
      if (keep) remember(key, { at: Date.now(), body: res.body, etag: res.etag, lastModified: res.lastModified })
      return { body: res.body, cached: false }
    }
    if ((res.status === 429 || res.status >= 500) && a < retries) { await new Promise(r => setTimeout(r, 2000 * (a + 1))); continue }
    throw new Error(`HTTP ${res.status}`)
  }
}

// ── RSS ─────────────────────────────────────────────────────────────────────
const tagRe = new Map()
function tagInner(block, name) {
  if (!tagRe.has(name)) tagRe.set(name, new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i'))
  return block.match(tagRe.get(name))?.[1] ?? null
}
// XML text content: CDATA sections verbatim, entities decoded elsewhere
function xmlText(raw) {
  if (raw == null) return ''
  let out = '', last = 0
  for (const m of raw.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) { out += decodeEntities(raw.slice(last, m.index)) + m[1]; last = m.index + m[0].length }
  return out + decodeEntities(raw.slice(last))
}
// RSS 2.0 <item>s (and Atom <entry>s) → { title, link, description, date }
export function parseRss(xml) {
  const out = []
  const blocks = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)]
  const atom = blocks.length ? [] : [...String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)]
  for (const [, b] of [...blocks, ...atom]) {
    const title = plain(xmlText(tagInner(b, 'title')))
    let link = plain(xmlText(tagInner(b, 'link')))
    if (!/^https?:\/\//i.test(link)) link = b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || ''
    if (!/^https?:\/\//i.test(link)) {
      const guid = plain(xmlText(tagInner(b, 'guid')))
      if (/^https?:\/\//i.test(guid)) link = guid
    }
    const description = plain(xmlText(tagInner(b, 'description') ?? tagInner(b, 'summary') ?? ''))
    const when = plain(xmlText(tagInner(b, 'pubDate') ?? tagInner(b, 'dc:date') ?? tagInner(b, 'published') ?? tagInner(b, 'updated') ?? ''))
    out.push({ title, link: decodeEntities(link), description, date: Date.parse(when) })
  }
  return out
}

async function rssFeed(f, ctx) {
  const { body, cached } = await getText(f.url, { UA: ctx.UA, accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' })
  const rows = parseRss(body)
  if (!rows.length && !/<rss\b|<feed\b|<rdf:RDF\b/i.test(body)) throw new Error('not an RSS feed')
  const items = []
  for (const r of rows) {
    if (!r.title || !/^https?:\/\//i.test(r.link)) continue
    const t = Number.isFinite(r.date) ? r.date : ctx.now
    if (t < ctx.cutoff) continue
    const dek = r.description && r.description !== r.title ? cut(r.description, DEK_MAX) : null
    items.push({
      id: idForUrl(r.link), url: cleanUrl(r.link), title: r.title, dek,
      source: f.source, outlet: f.outlet, section: f.section,
      published: iso(Math.min(t, ctx.now + 3600e3)), fetched: ctx.fetched,
      kind: 'article', paywalled: true, tickers: [],
    })
  }
  items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  return { items: items.slice(0, PER_FEED_MAX), cached }
}

// ── FMP stock news ──────────────────────────────────────────────────────────
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
const nyOffsetMin = ms => {
  const v = NY.formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value || 'GMT-5'
  const m = v.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/)
  return m && m[1] ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0
}
// "2026-10-12 09:01:02" in New York → UTC ISO
export function easternToIso(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return iso(Date.parse(s))
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  let t = wall - nyOffsetMin(wall) * 60e3
  t = wall - nyOffsetMin(t) * 60e3
  return iso(t)
}

async function fmpSymbol(symbol, ctx) {
  const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(symbol)}&limit=${ctx.fmpLimit}&apikey=${ctx.FMP_KEY}`
  const { body, cached } = await getText(url, { UA: ctx.UA, key: `fmp-news:${symbol}:${ctx.fmpLimit}`, accept: 'application/json' })
  let j
  try { j = JSON.parse(body) } catch { throw new Error('not JSON') }
  if (!Array.isArray(j)) throw new Error(String(j?.['Error Message'] || j?.error || 'unexpected reply').replaceAll(ctx.FMP_KEY, '***').slice(0, 160))
  const items = []
  for (const n of j) {
    if (!n?.url || !n?.title || !/^https?:\/\//i.test(n.url)) continue
    const published = easternToIso(n.publishedDate) || ctx.fetched
    if (Date.parse(published) < ctx.cutoff) continue
    const host = siteOf(n.url), site = String(n.site || '').toLowerCase().replace(/^www\./, '')
    const known = SITES[host] || SITES[site] || SITES[host.split('.').slice(-2).join('.')]
    const dek = plain(n.text)
    const writeup = isWriteup(n.url)
    items.push({
      id: idForUrl(n.url), url: cleanUrl(n.url), title: plain(n.title), dek: dek ? cut(dek, DEK_MAX) : null,
      source: 'FMP', outlet: known?.[0] || plain(n.publisher) || site || host || 'FMP', section: writeup ? 'Contributor analysis' : null,
      published, fetched: ctx.fetched, kind: 'article', paywalled: Boolean(known?.[1]) || writeup, tickers: [symbol],
      ...(writeup ? { writeup: true } : {}),
    })
  }
  return { items, cached }
}

// ── Seeking Alpha write-ups ─────────────────────────────────────────────────
// A write-up is a Seeking Alpha analysis article (seekingalpha.com/article/...),
// as opposed to its news wire (/news/...), which the desk leaves out.
const SA = 'https://seekingalpha.com/'
const SA_PICKS = { feed: "Seeking Alpha Editors' Picks", path: 'tag/editors-picks.xml' }
const SA_ACCEPT = 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
export const isWriteup = url => /^https?:\/\/(www\.)?seekingalpha\.com\/article\/\d/i.test(String(url || ''))
// One Seeking Alpha feed's write-ups. The feed tags each item with the symbols it
// covers (<sa:symbol>); those on the watchlist become the item's tickers, plus the
// symbol whose feed it is.
function saWriteups(xml, ctx, watch, symbol = null) {
  const blocks = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map(m => m[1])
  if (!blocks.length && !/<rss\b/i.test(xml)) throw new Error('not an RSS feed')
  const items = []
  for (const b of blocks) {
    const title = plain(xmlText(tagInner(b, 'title')))
    const link = decodeEntities(plain(xmlText(tagInner(b, 'link'))))
    if (!title || !isWriteup(link)) continue
    const t = Date.parse(plain(xmlText(tagInner(b, 'pubDate'))))
    const when = Number.isFinite(t) ? t : ctx.now
    if (when < ctx.cutoff) continue
    const syms = [...b.matchAll(/<sa:symbol>([^<]+)<\/sa:symbol>/gi)].map(m => plain(m[1]).toUpperCase()).filter(s => watch.has(s))
    const author = plain(xmlText(tagInner(b, 'sa:author_name'))) || null
    items.push({
      id: idForUrl(link), url: cleanUrl(link), title, dek: null,
      source: 'SeekingAlpha', outlet: 'Seeking Alpha', section: 'Contributor analysis',
      published: iso(Math.min(when, ctx.now + 3600e3)), fetched: ctx.fetched,
      kind: 'article', paywalled: true, tickers: [...new Set([...(symbol ? [symbol] : []), ...syms])],
      writeup: true, ...(author ? { author } : {}),
    })
  }
  return items
}
async function saAll(tickers, ctx, scrub, latestOf) {
  const watch = new Set(tickers.map(t => t.symbol))
  // Seeking Alpha's bot protection now and then answers a single request 403; one
  // more try two seconds later usually gets the feed
  const get1 = url => getText(url, { UA: ctx.UA, accept: SA_ACCEPT })
  const get = url => get1(url).catch(e => (/HTTP 403/.test(e.message) ? new Promise(r => setTimeout(r, 2000)).then(() => get1(url)) : Promise.reject(e)))
  const picks = await (async () => {
    try {
      const { body, cached } = await get(SA + SA_PICKS.path)
      const items = saWriteups(body, ctx, watch)
      return { items, health: { feed: SA_PICKS.feed, source: 'SeekingAlpha', ok: true, count: items.length, latest: latestOf(items), cached } }
    } catch (e) {
      return { items: [], health: { feed: SA_PICKS.feed, source: 'SeekingAlpha', ok: false, count: 0, latest: null, error: scrub(e.message) } }
    }
  })()
  const h = { feed: 'Seeking Alpha write-ups by ticker', source: 'SeekingAlpha', ok: false, count: 0, latest: null }
  if (!tickers.length) return { items: picks.items, health: [picks.health, { ...h, error: 'watchlist is empty' }] }
  const failed = [], per = []
  let cachedAll = true
  await Promise.all(tickers.map(async t => {
    try {
      const { body, cached } = await get(`${SA}api/sa/combined/${encodeURIComponent(t.symbol)}.xml`)
      per.push(...saWriteups(body, ctx, watch, t.symbol))
      if (!cached) cachedAll = false
    } catch (e) { failed.push(`${t.symbol} (${scrub(e.message)})`) }
  }))
  const byTicker = { ...h, ok: failed.length < tickers.length, count: per.length, latest: latestOf(per), cached: cachedAll }
  if (failed.length) byTicker.error = `${failed.length} of ${tickers.length} symbols failed: ${failed.join('; ')}`
  return { items: [...picks.items, ...per], health: [picks.health, byTicker] }
}

// ── SEC EDGAR ───────────────────────────────────────────────────────────────
const details = new Map()           // accession → { parties, docs, text, headline, lede }
const DETAILS_MAX = 400
const titleCase = s => (s && s === s.toUpperCase() && /[A-Z]/.test(s)
  ? s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (w, a, b) => (/^(llc|lp|llp|plc|nv|sa|ag|ab|usa|us|ii|iii|iv|etf|lllp|n\.a)$/.test(w) ? w.toUpperCase() : /^(of|and|the|de|du|la|for|in)$/.test(w) ? w : a.toUpperCase() + b))
    .replace(/^./, c => c.toUpperCase())
  : s)
const cleanParty = s => titleCase(String(s || '').replace(/\s*\/[A-Z]{2,3}\/?\s*$/, '').trim())

export function parseFilingIndex(html) {
  const parties = [...String(html).matchAll(/<span class="companyName">([\s\S]*?)<\/span>/gi)].map(m => {
    const t = plain(m[1])
    return {
      name: cleanParty(t.replace(/\s*\((Filer|Filed by|Subject|Reporting|Issuer)\b[\s\S]*$/i, '')),
      role: (t.match(/\((Filer|Filed by|Subject|Reporting|Issuer)\b/i)?.[1] || '').toLowerCase(),
      cik: padCik(t.match(/CIK\s*:?\s*(\d{3,10})/i)?.[1]),
    }
  })
  const table = String(html).match(/<table[^>]*class="tableFile"[^>]*>([\s\S]*?)<\/table>/i)?.[1] || ''
  const docs = []
  for (const r of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1])
    if (cells.length < 4) continue
    const href = cells[2].match(/href="([^"]+)"/i)?.[1]
    if (!href) continue
    const p = href.replace(/^\/ix\?doc=/i, '')
    docs.push({ description: plain(cells[1]), type: plain(cells[3]).toUpperCase(), url: /^https?:/i.test(p) ? p : `https://www.sec.gov${p}` })
  }
  return { parties, docs }
}

const BOILER = /^(exhibit|ex-?\s?99|item\s+\d|for immediate release|news release|press release|media (contact|relations|inquiries)|investor (contact|relations|inquiries)|contacts?\b|page \d|table of contents|index to exhibits|form (6|8)-k|united states|securities and exchange commission|washington, d\.?c|commission file|registration no|indicate by check mark|form 20-f|form 40-f|signatures?$|\(?(unaudited|in millions))/i
const MONTH_START = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i
// paragraphs: blank-line separated, the line breaks inside one joined
const paragraphs = text => String(text || '').split(/\n\s*\n/).map(p => p.split('\n').map(s => s.trim()).filter(Boolean).join(' ')).filter(Boolean)

// An all-capitals headline in title case; short all-capital words (AI, CEO)
// are taken for acronyms and kept.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'per', 'vs'])
const PLAIN_SHORT = /^(INC|CO|LTD|NEW|TOP|ITS|ONE|TWO|SIX|TEN|ALL|NET|HAS|ARE|WAS|NOT|NOW|OUT|OFF|BIG|LOW|SET|WIN|BUY|CUT|ADD|END|DUE|KEY|USE|OIL|GAS|CAR|SAY|SEE|RUN|PAY|TAX|WAR|LAW|AID|AIM|ACT|BID|BUYS|SELLS|SAYS|SEES|ADDS|WINS|CUTS|SETS|ENDS|PLAN|PLANS)$/
const KEEP_CAPS = /^(NYSE|NASDAQ|NAND|DRAM|GAAP|SOFR|EBITDA|LLC|PLC|USA|ETF|IPO|M&A)$/
export function tidyCaps(s) {
  const letters = String(s).replace(/[^A-Za-z]/g, '')
  if (letters.length < 10 || letters !== letters.toUpperCase()) return s
  return String(s).split(' ').map((w, i) => {
    const core = w.replace(/[^A-Za-z0-9&]/g, '')
    if (!core || /\d/.test(core) || KEEP_CAPS.test(core)) return w
    if (i > 0 && SMALL_WORDS.has(core.toLowerCase())) return w.toLowerCase()
    if (core.length <= 3 && !PLAIN_SHORT.test(core)) return w
    return w.toLowerCase().replace(/(^|[-'’(“"/])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  }).join(' ')
}
// first sentence, not fooled by Inc. or N.V.
function firstSentence(s, min = 60, max = 320) {
  const re = /[.!?](?=\s+["“‘(]?[A-Z0-9]|\s*$)/g
  for (let m; (m = re.exec(s));) {
    const end = m.index + 1
    if (end < min) continue
    if (end > max) break
    const tail = s.slice(Math.max(0, end - 8), end)
    if (/\b(Inc|Corp|Co|Ltd|Mr|Ms|Mrs|Dr|Jr|Sr|St|No|vs|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/.test(tail) || /(^|[\s(])([A-Z]\.){1,3}$/.test(tail)) continue
    return s.slice(0, end)
  }
  return cut(s, max)
}
const WIRE = /\((?:GLOBE NEWSWIRE|BUSINESS WIRE|PR NEWSWIRE|PRNewswire|ACCESSWIRE|ACCESS Newswire)\)\s*[-–—]*\s*/i
const DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\.|Feb\.|Mar\.|Apr\.|Jun\.|Jul\.|Aug\.|Sept?\.|Oct\.|Nov\.|Dec\.)\s+\d{1,2},\s+\d{4}\b/
// A release paragraph that runs "Headline CITY, ST. Month D, YYYY — Company today
// announced ..." → { head, rest }. Null when the date is not a dateline (it
// follows a lowercase word: "... said that on May 1, 2026").
function splitDateline(p) {
  const m = p.match(DATE_RE)
  if (!m || m.index < 8) return null
  const before = p.slice(0, m.index)
  if (/\b[a-z]+,?\s*$/.test(before)) return null
  const head = before.replace(/[\s,–—-]+$/, '')
    .replace(/\s+[A-Z][A-Z.'’-]{2,}(?:\s+[A-Z][A-Z.'’-]+)*(?:,\s*[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*)*$/, '')   // the dateline city: LIVINGSTON, N.J.
    .replace(/[\s,–—-]+$/, '').trim()
  const rest = p.slice(m.index + m[0].length).replace(/^[\s,–—-]+/, '').replace(WIRE, '').replace(/^[\s,–—-]+/, '').trim()
  return { head, rest }
}
const headlineLike = h => h && h.length >= 20 && h.length <= 220 && h.split(/\s+/).length >= 4 && !BOILER.test(h) && !/^[A-Z][A-Z .'’-]{2,},/.test(h) && !/\btoday\b/i.test(h)
function headlineOf(text) {
  for (const p of paragraphs(text).slice(0, 30)) {
    if (p.length < 20 || p.includes(' | ') || BOILER.test(p) || MONTH_START.test(p)) continue
    if (/^[\d\s,.$%()\-–—/:]+$/.test(p) || p.split(/\s+/).length < 4 || /^[·•▪●-]/.test(p)) continue
    if (p.length > 240 || /\btoday announced\b|\bannounced today\b/i.test(p) || WIRE.test(p)) {
      // the lede paragraph; it may still open with the headline
      const sp = splitDateline(p)
      if (sp && headlineLike(sp.head)) return tidyCaps(sp.head)
      continue
    }
    return tidyCaps(p)
  }
  return null
}
function ledeOf(text, headline) {
  let first = null, seen = 0
  for (const p of paragraphs(text).slice(0, 60)) {
    if (p.length < 80 || p.includes(' | ') || BOILER.test(p) || /^[·•▪●-]/.test(p)) continue
    if (headline && tidyCaps(p) === headline) continue
    if (++seen > 4) break
    const sp = splitDateline(p)
    // prefer the dateline paragraph ("CITY, date — Company today announced ...")
    if (sp && sp.rest.length >= 60) return firstSentence(sp.rest)
    if (/\bannounced\b/i.test(p)) return firstSentence(p.replace(WIRE, ''))
    if (!first) first = p
  }
  return first ? firstSentence(first.replace(WIRE, '')) : null
}
// The operative part of a filing's main document. The cover page (check boxes,
// addresses) goes: an 8-K is read from its first Item heading, a 6-K from after
// its last cover check-box line. The signature block goes too, but not what
// follows it: a 6-K often carries its release after the signature.
function bodyOf(text, form) {
  let lines = String(text || '').split('\n')
  if (/^8-K/.test(form)) { const i = lines.findIndex(l => /^\s*Item\s+\d\.\d{2}\b/i.test(l)); if (i > 0) lines = lines.slice(i) }
  if (/^6-K/.test(form)) {
    let last = -1
    for (let i = 0; i < Math.min(lines.length, 150); i++) if (/Indicate by check mark|^\s*Form 20-F\b|^\s*Form 40-F\b|Regulation S-T Rule 101/i.test(lines[i])) last = i
    if (last >= 0) lines = lines.slice(last + 1)
  }
  const s = lines.findIndex(l => /^\s*SIGNATURES?\s*$/i.test(l))
  if (s >= 0) {
    const sig = lines.slice(s, s + 30).findIndex(l => /\/s\//.test(l))
    let k = sig >= 0 ? s + sig + 1 : s + 1
    // the signer's name and title: up to three short lines after the /s/ line
    for (let n = 0; k < lines.length && n < 3; k++) {
      const l = lines[k].trim()
      if (!l) continue
      if (l.length > 70 || /\b(report|announce|results|revenue)/i.test(l)) break
      n++
    }
    lines = [...lines.slice(0, s), ...lines.slice(k)]
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
const exNum = type => { const m = String(type).match(/EX-99\.?(\d*)/); return m ? +(m[1] || 0) : 99 }

// rows: the same accession as listed under each watchlist company that has it
async function filingDetail(rows, ctx) {
  const row = rows[0]
  if (details.has(row.adsh)) return details.get(row.adsh)
  const base = `https://www.sec.gov/Archives/edgar/data/${+row.cik}/${row.adsh.replace(/-/g, '')}`
  const { body } = await getText(`${base}/${row.adsh}-index.htm`, { UA: ctx.SEC_UA, keep: false, timeout: 30e3, retries: 2 })
  const { parties, docs } = parseFilingIndex(body)
  // textTried: the form's text was read; partial: a document of it failed
  const d = { parties, docs, text: null, headline: null, lede: null, textTried: false, partial: false }
  let partial = false
  if (TEXT_FORMS.test(row.form) && !(row.subjectOnly && !rows.some(r => isSubject(d, r.cik)))) {
    d.textTried = true
    const baseForm = row.form.replace(/\/A$/, '')
    const primary = docs.find(x => x.type === row.form || x.type === baseForm) || docs[0]
    // a 13D's exhibits are joint-filing agreements and powers of attorney: skip them
    const exhibits = /13D/.test(row.form) ? [] : docs.filter(x => /^EX-99/.test(x.type) && /\.(htm|html|txt)$/i.test(x.url)).sort((a, b) => exNum(a.type) - exNum(b.type)).slice(0, 2)
    const parts = []
    let room = TEXT_CAP
    const add = (label, t, cap) => {
      if (!t || room < 200) return
      const piece = `[${label}]\n${t}`.slice(0, Math.min(cap, room))
      parts.push(piece); room -= piece.length + 2
    }
    let mainText = null, exText = null
    if (primary && /\.(htm|html|txt|xml)$/i.test(primary.url)) {
      try {
        mainText = bodyOf(htmlToText((await getText(primary.url, { UA: ctx.SEC_UA, keep: false, timeout: 30e3, retries: 2 })).body), row.form)
        add(`Form ${row.form}`, mainText, exhibits.length ? 8000 : TEXT_CAP)
      } catch (e) { partial = true; ctx.secNotes.push(`${row.form} ${row.adsh} main document: ${e.message}`) }
    }
    for (const x of exhibits) {
      try {
        const t = htmlToText((await getText(x.url, { UA: ctx.SEC_UA, keep: false, timeout: 30e3, retries: 2 })).body)
        if (!exText) exText = t
        add(`Exhibit ${x.type.replace(/^EX-/, '')}${x.description && !/^ex(hibit)?[-\s]*99/i.test(x.description) ? `: ${x.description}` : ''}`, t, TEXT_CAP)
      } catch (e) { partial = true; ctx.secNotes.push(`${row.form} ${row.adsh} ${x.type}: ${e.message}`) }
    }
    d.text = parts.join('\n\n').slice(0, TEXT_CAP) || null
    // headline: from the press release (an 8-K's own body has none; a 6-K's
    // often is the release); lede: the release, else the filing's own words
    if (!/13D/.test(row.form)) {
      d.headline = headlineOf(exText || (/^6-K/.test(row.form) ? mainText : null))
      d.lede = ledeOf(exText || mainText, d.headline)
    }
  }
  // A filing read only in part is fetched again next run: it is not cached
  // here, its item carries textPartial (so secAll fetches it again although
  // the store holds some text), and index.js does not deep-read it until then.
  d.partial = partial
  if (!partial) {
    details.set(row.adsh, d)
    while (details.size > DETAILS_MAX) details.delete(details.keys().next().value)
  }
  return d
}
const isSubject = (d, cik) => d.parties.some(p => p.cik === padCik(cik) && /subject|issuer/.test(p.role))
const partyName = (d, role) => d.parties.find(p => p.role === role)?.name || null

const fmtDay = s => { const t = Date.parse(`${s}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : s }

// one filing → Item, or null when it is not about the watchlist company
function filingItem(row, d, ctx) {
  const name = row.short
  const amend = /\/A$/.test(row.form)
  const formLabel = row.form.replace(/^SC /, 'Schedule ').replace(/^SCHEDULE /, 'Schedule ').replace('14D9', '14D-9')
  let title, section, dek = null
  if (/^8-K/.test(row.form)) {
    const codes = String(row.items || '').split(',').map(s => s.trim()).filter(Boolean)
    const what = codes.filter(c => c !== '9.01').map(c => ITEMS_8K[c] || `item ${c}`)
    const labels = codes.map(c => `${c} ${ITEMS_8K[c] || 'other'}`).join('; ')
    section = 'Current report'
    title = d?.headline
      ? (d.headline.toLowerCase().includes(name.toLowerCase()) ? d.headline : `${name}: ${d.headline}`)
      : `${name} ${row.form}: ${what.length ? what.join(', ') : 'exhibits'}`
    dek = d?.lede || (labels ? `Items ${labels}.` : null)
  } else if (/^6-K/.test(row.form)) {
    section = 'Foreign issuer report'
    const desc = String(row.primaryDocDescription || '').trim()
    title = d?.headline
      ? (d.headline.toLowerCase().includes(name.toLowerCase()) ? d.headline : `${name}: ${d.headline}`)
      : `${name} files a report as a foreign issuer (${row.form})${desc && !/^(form\s*)?6-k$/i.test(desc) ? `: ${desc}` : ''}`
    dek = d?.lede || null
  } else if (/^10-K|^20-F|^40-F/.test(row.form)) {
    section = 'Annual report'
    title = `${name} files its annual report (${row.form})${row.reportDate ? ` for the year ended ${fmtDay(row.reportDate)}` : ''}`
  } else if (/^10-Q/.test(row.form)) {
    section = 'Quarterly report'
    title = `${name} files its quarterly report (${row.form})${row.reportDate ? ` for the quarter ended ${fmtDay(row.reportDate)}` : ''}`
  } else if (/^DEF 14A/.test(row.form)) {
    section = 'Proxy statement'
    title = `${name} files its proxy statement (${row.form})`
  } else if (/13D|13G/.test(row.form)) {
    if (!d || !isSubject(d, row.cik)) return null
    const by = partyName(d, 'filed by') || partyName(d, 'reporting') || 'An investor'
    const active = /13D/.test(row.form)
    section = 'Ownership stake'
    title = amend
      ? `${by} updates its ${active ? 'active' : 'passive'} stake in ${name} (${formLabel})`
      : `${by} reports ${active ? 'an active' : 'a passive'} stake of 5% or more in ${name} (${formLabel})`
    dek = active ? 'Schedule 13D: a holder of 5% or more who may seek to influence the company.' : 'Schedule 13G: a holder of 5% or more with no intent to influence the company.'
  } else if (/^SC TO-I/.test(row.form)) {
    section = 'Tender offer'
    title = `${name} ${amend ? 'updates its' : 'opens a'} tender offer for its own securities (${formLabel})`
  } else if (/^SC TO-T/.test(row.form)) {
    section = 'Tender offer'
    const bidder = d ? partyName(d, 'filed by') : null, target = d ? partyName(d, 'subject') : null
    title = d && isSubject(d, row.cik)
      ? `${bidder || 'A bidder'} ${amend ? 'updates its' : 'launches a'} tender offer for ${name} (${formLabel})`
      : `${name} ${amend ? 'updates its' : 'launches a'} tender offer${target ? ` for ${target}` : ''} (${formLabel})`
  } else if (/^SC 14D9/.test(row.form)) {
    section = 'Tender offer'
    title = `${name} ${amend ? 'updates its' : 'gives its'} response to a tender offer (${formLabel})`
  } else return null
  const base = `https://www.sec.gov/Archives/edgar/data/${+row.cik}/${row.adsh.replace(/-/g, '')}`
  const item = {
    id: idForAccession(row.adsh),
    url: row.primaryDocument ? `${base}/${row.primaryDocument}` : `${base}/${row.adsh}-index.htm`,
    title, dek: dek ? cut(dek, DEK_MAX) : null,
    source: 'SEC', outlet: 'SEC EDGAR', section,
    published: iso(Date.parse(row.acceptanceDateTime)) || iso(Date.parse(`${row.filingDate}T21:00:00Z`)),
    fetched: ctx.fetched, kind: 'filing', paywalled: false, tickers: [...row.symbols],
    form: row.form,
  }
  if (row.items) item.filingItems = row.items
  if (d?.text) item.text = d.text
  // true while a document failed; false once all were read (store.js then drops the flag)
  if (d?.textTried) item.textPartial = Boolean(d.partial)
  return item
}

async function secCompany(cik, symbols, ctx) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`
  const { body, cached } = await getText(url, { UA: ctx.SEC_UA, accept: 'application/json', timeout: 30e3, retries: 2 })
  const sub = JSON.parse(body)
  const rc = sub?.filings?.recent || {}
  const n = (rc.accessionNumber || []).length
  const rows = []
  for (let i = 0; i < n; i++) {
    if (!(rc.filingDate[i] >= ctx.secSince)) continue
    const form = String(rc.form[i] || '').trim()
    if (!SEC_FORMS.test(form)) continue
    rows.push({
      cik, symbols, adsh: rc.accessionNumber[i], form, filingDate: rc.filingDate[i], reportDate: rc.reportDate?.[i] || '',
      acceptanceDateTime: rc.acceptanceDateTime?.[i] || '', items: rc.items?.[i] || '', primaryDocument: rc.primaryDocument?.[i] || '',
      primaryDocDescription: rc.primaryDocDescription?.[i] || '', subjectOnly: /13[DG]/.test(form),
      short: shortName(ctx.nameOf(symbols[0]) || titleCase(sub.name) || symbols[0]),
    })
  }
  return { rows, cached }
}

async function secAll(tickers, ctx) {
  const byCik = new Map()
  for (const t of tickers) { const c = padCik(t.cik); if (c) byCik.set(c, [...(byCik.get(c) || []), t.symbol]) }
  const health = { feed: 'SEC EDGAR filings', source: 'SEC', ok: true, count: 0, latest: null, cached: true }
  if (!byCik.size) return { items: [], health: { ...health, ok: false, error: 'no watchlist CIKs (profile has none)' } }
  const failed = [], rows = [], items = []
  await Promise.all([...byCik].map(async ([cik, symbols]) => {
    try { const r = await secCompany(cik, symbols, ctx); rows.push(...r.rows); if (!r.cached) health.cached = false } catch (e) { failed.push(`${symbols.join('/')} (${e.message})`) }
  }))
  // one filing can sit under two watchlist companies (a stake one holds in the
  // other, a tender between them): one item, every ticker involved
  const byAdsh = new Map()
  for (const r of rows) byAdsh.set(r.adsh, [...(byAdsh.get(r.adsh) || []), r])
  let skipped = 0
  await Promise.all([...byAdsh.values()].map(async group => {
    const first = group[0]
    const id = idForAccession(first.adsh)
    // the store already has it (and all its text, where the form has some): nothing to fetch
    const have = ctx.known ? ctx.known(id) : null
    if (have && (have === true || !TEXT_FORMS.test(first.form) || (have.text && !have.textPartial))) { skipped++; return }
    const needsIndex = TEXT_FORMS.test(first.form) || /13[DG]|^SC TO-T/.test(first.form)
    let d = null
    if (needsIndex) {
      try { d = await filingDetail(group, ctx) } catch (e) {
        ctx.secNotes.push(`${first.form} ${first.adsh} index: ${e.message}`)
        if (first.subjectOnly) return          // cannot tell whose stake it is; try again next run
      }
    }
    // for a stake or a tender, describe it from the side of the company it is about
    const lead = (d && group.find(r => isSubject(d, r.cik))) || first
    const row = { ...lead, symbols: [...new Set(group.flatMap(r => r.symbols))] }
    const it = filingItem(row, d, ctx)
    if (it) items.push(it)
  }))
  health.count = items.length
  health.latest = items.length ? iso(Math.max(...items.map(i => Date.parse(i.published)))) : null
  if (skipped) health.skipped = skipped
  const problems = [...failed, ...ctx.secNotes]
  if (failed.length) { health.ok = failed.length < byCik.size; health.error = `${failed.length} of ${byCik.size} companies failed: ${failed.join('; ')}` }
  else if (problems.length) health.error = `${problems.length} document${problems.length === 1 ? '' : 's'} not read: ${problems.slice(0, 3).join('; ')}`
  return { items, health }
}

// ── the run ─────────────────────────────────────────────────────────────────
function mergeFetched(a, b) {
  a.tickers = [...new Set([...(a.tickers || []), ...(b.tickers || [])])]
  if (!a.dek && b.dek) a.dek = b.dek
  if (!a.section && b.section) a.section = b.section
  if (!a.text && b.text) a.text = b.text
  a.paywalled = a.paywalled || b.paywalled
  if (b.writeup) { a.writeup = true; if (!a.author && b.author) a.author = b.author }
  if (Date.parse(b.published) < Date.parse(a.published)) a.published = b.published
  return a
}

let running = null
export function fetchAll(opts = {}) {
  if (!running) running = run(opts).finally(() => { running = null })
  return running
}

async function run({ UA, FMP_KEY, profile, known, maxAgeDays = 7, secDays = 14, fmpLimit = 20, SEC_UA } = {}) {
  const now = Date.now()
  const tickers = (profile?.tickers || []).filter(t => t && t.symbol)
  const names = new Map(tickers.map(t => [t.symbol, t.name]))
  const ctx = {
    UA: UA || BROWSER_UA, SEC_UA: SEC_UA || UA || BROWSER_UA, FMP_KEY, known: typeof known === 'function' ? known : null,
    now, fetched: iso(now), cutoff: now - maxAgeDays * DAY, fmpLimit,
    secSince: new Date(now - secDays * DAY).toISOString().slice(0, 10), secNotes: [],
    nameOf: s => names.get(s) || null,
  }
  const scrub = m => (FMP_KEY ? String(m).replaceAll(FMP_KEY, '***') : String(m))
  const latestOf = list => (list.length ? iso(Math.max(...list.map(i => Date.parse(i.published)).filter(Number.isFinite))) : null)

  const rssJob = Promise.all(RSS_FEEDS.map(async f => {
    try {
      const { items, cached } = await rssFeed(f, ctx)
      return { items, health: { feed: f.feed, source: f.source, ok: true, count: items.length, latest: latestOf(items), cached } }
    } catch (e) {
      return { items: [], health: { feed: f.feed, source: f.source, ok: false, count: 0, latest: null, error: scrub(e.message) } }
    }
  }))

  const fmpJob = (async () => {
    const h = { feed: 'FMP stock news', source: 'FMP', ok: false, count: 0, latest: null }
    if (!FMP_KEY) return { items: [], health: { ...h, error: 'no FMP key' } }
    if (!tickers.length) return { items: [], health: { ...h, error: 'watchlist is empty' } }
    const failed = [], all = []
    let cachedAll = true
    await Promise.all(tickers.map(async t => {
      try { const r = await fmpSymbol(t.symbol, ctx); all.push(...r.items); if (!r.cached) cachedAll = false } catch (e) { failed.push(`${t.symbol} (${scrub(e.message)})`) }
    }))
    const health = { ...h, ok: failed.length < tickers.length, count: all.length, latest: latestOf(all), cached: cachedAll }
    if (failed.length) health.error = `${failed.length} of ${tickers.length} symbols failed: ${failed.join('; ')}`
    return { items: all, health }
  })()

  const secJob = secAll(tickers, ctx).catch(e => ({ items: [], health: { feed: 'SEC EDGAR filings', source: 'SEC', ok: false, count: 0, latest: null, error: scrub(e.message) } }))
  const saJob = saAll(tickers, ctx, scrub, latestOf).catch(e => ({ items: [], health: [{ feed: 'Seeking Alpha write-ups', source: 'SeekingAlpha', ok: false, count: 0, latest: null, error: scrub(e.message) }] }))

  const [rss, fmp, sec, sa] = await Promise.all([rssJob, fmpJob, secJob, saJob])
  // outlets first, so an FMP copy of a WSJ story (or of a Seeking Alpha write-up) folds into the outlet's item
  const byId = new Map()
  for (const it of [...rss.flatMap(r => r.items), ...sa.items, ...fmp.items, ...sec.items]) {
    const prev = byId.get(it.id)
    byId.set(it.id, prev ? mergeFetched(prev, it) : it)
  }
  const items = [...byId.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published) || a.id.localeCompare(b.id))
  return { items, health: [...rss.map(r => r.health), ...sa.health, fmp.health, sec.health] }
}
