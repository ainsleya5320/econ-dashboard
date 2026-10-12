// ============================================================================
// NEWS DESK: the integrator behind the News Desk tab (src/tabs/NewsDeskTab.jsx).
// It reads the news (feeds.js) against the watchlist and the tracked
// categories (profile.js), keeps every item in one file (store.js), has
// Claude score and read the items within a hard daily budget (analyzer.js,
// budget.js), and serves the tab, the clip window and the tab's actions.
//
//   createNewsDesk({ UA, dir, FMP_KEY, ANTHROPIC_KEY, tensions, dailyUsd = 2 }) → {
//     get(req)            the GET /api/news-desk payload (below); it never
//                         spends for a caller that is not this computer
//     handle(req, res)    everything under /api/news-desk: GET the payload;
//                         POST /refresh, /clip and /proposal (this computer only)
//     clipPage(req, res)  GET /news-clip, the confirm window the bookmarklet opens
//     refresh(opts)       one refresh cycle now (single-flight) → its summary
//     stop()              clear the background timer (Vite restarts the server
//                         in-process, and a new instance stops the old one)
//   }
//   tensions: a getter for both Tensions boards (see profile.js).
//
// The Item (feeds.js makes them, store.js keeps them, analyzer.js adds the rest):
//   { id         16 hex characters of the SHA-1 of the canonical URL (SEC: of
//                the accession number); a clip of a feed article shares its id
//     url, title, dek (the publisher's summary, or null)
//     source     'WSJ' | 'NYT' | 'Economist' | 'FMP' | 'SEC' | 'clip'
//     outlet     the display name; section: string or null
//     published, fetched (ISO); kind: 'article' | 'filing' | 'clip'; paywalled
//     tickers    from the source's metadata only (FMP's symbol, the SEC filer)
//     form?, filingItems? (filings); text? (clips and filings, ≤ 40,000 characters)
//     textPartial? true while a filing's document or exhibit failed to load
//                (feeds.js reads it again each run; it is not deep-read until then)
//     clipped?   when the reader clipped it (clips; published is the page's own date)
//     triage?    { at, model, relevance 0-100, tickers, categories, why, cluster }
//     analysis?  { at, model, basis: 'headline' | 'full-text', summary, facts,
//                  implications, novelty, tensions, proposals, watch, usd }
//                (field by field in analyzer.js)
//     error?     why the last deep read failed }
//
// The refresh cycle runs on POST /refresh, when the tab opens (a GET with the
// tab's view header, see isView) and the last refresh began over 30 minutes
// ago, and hourly, but only while the desk has been opened on this computer
// in the past 24 hours:
//   1. profile: tickers.json, FMP names, the categories, the Tensions checks
//   2. feeds → store.upsert (filings already held in full are not read again)
//   3. triage: every unscored item of the past week, clips and filings first,
//      then newest, in batches of 30 (Claude Haiku 5.5). Only failures that
//      are an item's own count against it (two, or one refusal, and it is
//      left alone); an outage stops the run after one failed call and
//      charges nothing (the rules are in analyzer.js above triage()).
//   4. deep reads: relevance 70 or more with a holding or category, published
//      in the last 4 days, one per story cluster (a full-text item may still
//      upgrade a story read from its headline), clips and the watchlist's own
//      filings first; at most 8 a refresh and 20 a day (Claude Opus 5.5). A
//      filing whose text feeds.js does not read (10-K, 10-Q, proxies, 13G),
//      or has read only in part, is not deep-read. A read that fails for the
//      item's own reason is tried once more on a later refresh; a refusal
//      never; an outage stops the stage and is not held against the item.
//      One read per item at a time, shared with clips (SHARED.reading).
//   5. the brief, when there are new deep reads: one after each of 6 am, noon
//      and 4 pm local (BRIEF_SLOTS), so at most 3 a day
//   6. prune items over 30 days old (clips and approved proposals stay), save
// Between midnight and 5 am (QUIET_FROM, QUIET_TO) the hourly and on-open
// refreshes only score; the Refresh button and clips still read in depth.
// A clip is read in full at once (scored first, so it joins its story).
// When the budget runs out the cycle stops spending and says so in the
// payload; budget.js holds any overrun to the one call in flight.
//
// Payload (GET /api/news-desk):
//   { built, lastAttempt, refreshing, refresh: { stage, since, reason } | null,
//     analysisOn, analysisReason,
//     budget (budget.today() plus deepEstimate and canDeepRead: whether a deep
//       read or a brief still fits under today's cap),
//     limits (the constants above the tab shows, clipMinChars among them),
//     counts: { items, today, relevant, analysed, clips, waiting, unscorable },
//     brief: { at, model, headline, sections: [{ title, target?, text, itemIds }] } | null,
//     items (without their text; triageGaveUp on an unscored item Claude failed on),
//     byTicker { SYMBOL: ids }, byCategory { id: ids } (each card's items: the
//       ones about it by score, then second-order ones by confidence; see targetsOf),
//     proposals: [{ itemId, index, file, row, evidence, quoted, status }],
//     profile: { tickers: [{ symbol, name }], categories: [{ id, label, description }],
//                tensions: [{ id, title, domain }] },
//     health (feeds.js), notes (plain-English lines), bookmarklet, lastRun, local }
//   A GET counts as a view (and may start a refresh) only with the tab's
//   X-News-Desk: view header; ?auto=0 (the tab's polls, scripts) never does.
//
// Security. The dev server listens on every interface, so:
//   - refresh, clip and proposal take requests from this computer only: the
//     socket is loopback, no proxy header is present (tailscale serve and other
//     proxies forward from loopback), the Host is a loopback name, and any
//     Origin is this same origin (another site, or another local port, gets 403);
//   - a GET starts a refresh only under the same test plus the view header,
//     which another page cannot send (isView), so no other page can spend;
//   - no CORS headers are sent, so other sites cannot read the payload through
//     the user's browser, and OPTIONS preflights are refused;
//   - bodies are capped (clips 300 KB, the rest 16 KB); keys are never logged;
//   - the clip page acts only on one message from window.opener whose origin
//     matches the article's address, and only after the user presses Send.
//
// Files at the repo root, all gitignored (they name the watchlist):
//   news-desk.json (store.js), news-desk-meta.json (the brief, feed health, the
//   last run, daily counters and brief slots, the last view, failure counts), news-usage.json (budget.js),
//   news-profile.json (profile.js). Approving a proposal appends one line to a
//   tracked table in data/ai/ (revenue-disclosures, ai-debt, pjm-capacity).
// ============================================================================
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fetchAll, cleanUrl, idForUrl, siteInfo } from './feeds.js'
import { buildProfile, readWatchlist, loadCategories } from './profile.js'
import { createStore, writeJsonAtomic, readJsonSafe, setAside, TEXT_CAP, FULL_TEXT_MIN } from './store.js'
import { createBudget, localDay } from './budget.js'
import { createAnalyzer } from './analyzer.js'

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5
const AUTO_AFTER = 30 * MIN          // a GET from this computer refreshes when the last began longer ago than this
const TIMER_EVERY = HOUR             // the background refresh...
const TIMER_TICK = 5 * MIN           // ...checked this often, so a server restart does not reset the hour
const VIEWED_WITHIN = DAY            // ...and run only when the desk was opened on this computer within this
const WINDOW_DAYS = 7                // what the tab shows, and what gets scored
const KEEP_DAYS = 30                 // store.prune
const REL_MIN = 40                   // relevant: a triage score at least this, with a holding or category
const DEEP_MIN = 70                  // deep-read candidates
const DEEP_RECENT_DAYS = 4
const DEEP_PER_DAY = 20
const DEEP_PER_REFRESH = 8
const DEEP_MAX_TRIES = 2             // failures that are the item's own (not an outage) before it is left alone
const BRIEF_PER_DAY = 3
const BRIEF_SLOTS = [6, 12, 16]      // local hours: one brief after each (6 am, noon, after the 4 pm close)
const QUIET_FROM = 0, QUIET_TO = 5   // local hours when automatic refreshes only score (no deep reads or brief)
const BRIEF_HOURS = 36               // what a brief covers, and how long one is shown
const BRIEF_MIN_REL = 50             // scored-only items a brief may mention
const TRIAGE_PER_REFRESH = 600
const TRIAGE_MAX_TRIES = 2           // failures that are the item's own; an outage counts for nothing
const GROUP_MAX = 30                 // items per holding or category card
const CLIP_BODY_MAX = 300 * 1024
const SMALL_BODY_MAX = 16 * 1024
const CLIP_MIN_CHARS = FULL_TEXT_MIN // a clip this long is read in full (analyzer.js uses the same number)
const META_FILE = 'news-desk-meta.json'
const LOCAL_ONLY = 'This works only in a browser on the computer running the dashboard: it spends the Claude budget or writes files.'

// One per process: Vite restarts the server in-process, so an old instance may
// still be finishing a refresh when the new one starts. They share this.
// reading: item id → the deep read in flight (either instance), so a clip and
// a refresh never pay twice for one article.
const SHARED = globalThis.__newsDeskShared || (globalThis.__newsDeskShared = { running: null, progress: null, doneSeq: 0, doneBy: null, stop: null })
SHARED.reading ||= new Map()

// ── small helpers ───────────────────────────────────────────────────────────
const iso = (t = Date.now()) => new Date(t).toISOString()
const oneLine = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const timeOf = it => Date.parse(it?.published) || Date.parse(it?.fetched) || 0
const isClip = it => !!it && (it.kind === 'clip' || it.source === 'clip')
const hasText = it => typeof it?.text === 'string' && it.text.length >= FULL_TEXT_MIN
const hourNow = () => new Date().getHours()
const isQuiet = (h = hourNow()) => h >= QUIET_FROM && h < QUIET_TO
// the brief slot a time falls in: the last slot hour at or before it, or null before the first
const slotOf = (t = Date.now()) => { const h = new Date(t).getHours(); return [...BRIEF_SLOTS].reverse().find(s => h >= s) ?? null }
const hourLabel = h => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`)
const sha16 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16)
const money = v => `$${(Number(v) || 0).toFixed(2)}`
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const httpError = (status, message) => Object.assign(new Error(message), { status })
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const clock = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// ── who is asking ───────────────────────────────────────────────────────────
const LOOPBACK_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host', 'tailscale-user-login', 'cf-connecting-ip']
// This computer, directly: a loopback socket, no proxy in between, a loopback Host.
export function fromLoopback(req) {
  if (!LOOPBACK_ADDR.has(req?.socket?.remoteAddress)) return false
  const h = req.headers || {}
  if (PROXY_HEADERS.some(k => h[k])) return false
  const host = String(h.host || '').toLowerCase().replace(/:\d+$/, '')
  return !host || LOOPBACK_HOST.test(host)
}
// A browser POST must come from this same origin: a page on another site (or
// another local port) the user happens to have open could otherwise spend
// the budget, because its requests also arrive from loopback.
export function sameOrigin(req) {
  const h = req.headers || {}
  const site = h['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (!h.origin) return true
  return h.origin === `http://${h.host}` || h.origin === `https://${h.host}`
}
// A GET counts as the user opening the desk (which may start a paid refresh
// and keeps the hourly refresh on) only when the tab itself sends it: from
// this computer, same origin, with the X-News-Desk: view header. Another page
// or local port cannot add that header without a CORS preflight, and the
// desk refuses preflights; an <img> or a no-cors fetch cannot add it at all.
export function isView(req) {
  if (!fromLoopback(req) || !sameOrigin(req)) return false
  const h = req.headers || {}
  if (String(h['x-news-desk'] || '').toLowerCase() !== 'view') return false
  if (h.referer) { try { if (new URL(h.referer).host !== h.host) return false } catch { return false } }
  return true
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const tooBig = () => httpError(413, `The request is over the ${Math.round(max / 1024)} KB limit.`)
    const len = Number(req.headers?.['content-length'])
    if (Number.isFinite(len) && len > max) { req.resume?.(); reject(tooBig()); return }
    const chunks = []
    let size = 0, over = false
    req.on('data', c => { if (over) return; size += c.length; if (size > max) { over = true; chunks.length = 0 } else chunks.push(c) })
    req.on('end', () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}
async function readJsonBody(req, max) {
  if (!/^application\/json\b/i.test(String(req.headers?.['content-type'] || ''))) { req.resume?.(); throw httpError(415, 'Send the request as application/json.') }
  const raw = await readBody(req, max)
  if (!raw.trim()) return {}
  let j
  try { j = JSON.parse(raw) } catch { throw httpError(400, 'The request body is not valid JSON.') }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw httpError(400, 'The request body is not a JSON object.')
  return j
}
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

// ── the run log, the brief and the daily counters (news-desk-meta.json) ─────
function createMeta(dir) {
  const file = path.join(dir, META_FILE)
  const blank = () => ({
    built: null, lastAttempt: null, lastViewed: null, health: [], brief: null, lastRun: null,
    tensions: [], days: {}, analysesSinceBrief: 0, readFailures: {}, triageFailures: {},
  })
  let data = blank(), readable = true, timer = null
  const load = () => {
    const r = readJsonSafe(file)
    if (r.state === 'missing') { data = blank(); readable = true; return }
    if (r.state === 'ok' && r.data && typeof r.data === 'object' && !Array.isArray(r.data)) { data = { ...blank(), ...r.data }; readable = true; return }
    if (r.state === 'error') { readable = false; console.warn(`News desk: cannot read ${META_FILE} (${r.error}); it is not saved until it can be read`); return }
    try {
      const dest = setAside(file)
      console.error(`News desk: ${META_FILE} could not be parsed; moved it to ${path.basename(dest)} and started a new one`)
      data = blank(); readable = true
    } catch (e) { readable = false; console.error(`News desk: ${META_FILE} is unreadable and could not be moved aside: ${e.message}`) }
  }
  load()
  const save = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!readable) { load(); if (!readable) return false }
    const days = Object.keys(data.days || {}).sort()
    for (const d of days.slice(0, Math.max(0, days.length - 14))) delete data.days[d]
    try { writeJsonAtomic(file, data); return true } catch (e) { console.error(`News desk: could not save ${META_FILE}: ${e.message}`); return false }
  }
  const saveSoon = () => { if (!timer) { timer = setTimeout(save, 2000); timer.unref?.() } }
  const day = (d = localDay()) => {
    data.days ||= {}
    return (data.days[d] ||= { deepReads: 0, briefs: 0 })
  }
  return { get data() { return data }, load, save, saveSoon, day }
}

// ── approved proposals → the tracked tables in data/ai/ ─────────────────────
const sameName = (a, b) => String(a ?? '').toLowerCase().replace(/\s*\(.*\)\s*/g, '').trim() === String(b ?? '').toLowerCase().replace(/\s*\(.*\)\s*/g, '').trim()
const TABLES = {
  'revenue-disclosures': {
    file: 'revenue-disclosures.json', key: 'disclosures', need: { d: 'string', co: 'string', arr: 'number' },
    same: (a, b) => sameName(a.co, b.co) && a.d === b.d,
  },
  'ai-debt': {
    file: 'ai-debt.json', key: 'deals', need: { date: 'string', borrower: 'string', amt: 'number', lender: 'string', type: 'string' },
    same: (a, b) => sameName(a.borrower, b.borrower) && a.date === b.date && Math.abs(Number(a.amt) - Number(b.amt)) < 0.05,
  },
  'pjm-capacity': {
    file: 'pjm-capacity.json', key: 'auctions', need: { auction: 'string', price: 'number' },
    same: (a, b) => a.auction === b.auction,
  },
}
// One row as the tables write them: {"a": 1, "b": "x"} on one line.
const rowLine = row => `{${Object.entries(row).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`
// The index of the bracket closing the one at `open`, skipping strings.
function closingBracket(s, open) {
  let depth = 0, inStr = false
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}
// Append one row to a table, keeping the file's one-row-per-line layout and
// everything else byte for byte. Refuses a row the table already has.
export function appendRow(dir, table, row) {
  const t = TABLES[table]
  if (!t) throw httpError(400, `There is no table called ${table}.`)
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw httpError(400, 'The proposal has no row.')
  for (const [k, type] of Object.entries(t.need)) {
    if (typeof row[k] !== type || (type === 'number' && !Number.isFinite(row[k])) || (type === 'string' && !row[k].trim())) throw httpError(400, `The proposed row has no valid ${k}.`)
  }
  for (const v of Object.values(row)) if (v !== null && typeof v === 'object') throw httpError(400, 'The proposed row is not flat.')
  const file = path.join(dir, 'data', 'ai', t.file)
  const raw = fs.readFileSync(file, 'utf8')
  const json = JSON.parse(raw)
  const rows = json[t.key]
  if (!Array.isArray(rows)) throw httpError(500, `data/ai/${t.file} has no "${t.key}" list.`)
  const dup = rows.find(r => r && t.same(r, row))
  if (dup) throw httpError(409, `data/ai/${t.file} already has that row (${rowLine(dup)}); dismiss the proposal instead.`)
  const keyAt = raw.search(new RegExp(`"${t.key}"\\s*:\\s*\\[`))
  if (keyAt < 0) throw httpError(500, `Could not find the "${t.key}" list in data/ai/${t.file}.`)
  const open = raw.indexOf('[', keyAt)
  const close = closingBracket(raw, open)
  if (close < 0) throw httpError(500, `The "${t.key}" list in data/ai/${t.file} is not closed.`)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let next
  if (rows.length) {
    let end = close
    while (end > open && /\s/.test(raw[end - 1])) end--
    const lineStart = raw.lastIndexOf('\n', end - 1) + 1
    const indent = raw.slice(lineStart).match(/^[ \t]*/)[0]
    next = `${raw.slice(0, end)},${eol}${indent}${rowLine(row)}${raw.slice(end)}`
  } else {
    const keyIndent = raw.slice(raw.lastIndexOf('\n', keyAt) + 1).match(/^[ \t]*/)[0]
    next = `${raw.slice(0, open + 1)}${eol}${keyIndent}  ${rowLine(row)}${eol}${keyIndent}${raw.slice(close)}`
  }
  // the result must parse, hold exactly one more row (this one, last), and leave the rest alone
  const check = JSON.parse(next)
  const after = check[t.key]
  const { [t.key]: _a, ...restBefore } = json
  const { [t.key]: _b, ...restAfter } = check
  if (!Array.isArray(after) || after.length !== rows.length + 1 || JSON.stringify(after[after.length - 1]) !== JSON.stringify(row)
    || JSON.stringify(after.slice(0, -1)) !== JSON.stringify(rows) || JSON.stringify(restBefore) !== JSON.stringify(restAfter)) {
    throw httpError(500, `Appending to data/ai/${t.file} would have changed more than one row; nothing was written.`)
  }
  writeJsonAtomic(file, next)
  return { file: `data/ai/${t.file}`, line: rowLine(row) }
}

// ── the clip window and the bookmarklet ─────────────────────────────────────
// The bookmarklet sends the page's canonical address when it is on the same
// site (an address opened from a newsletter carries the reader's subscriber
// ids; cleanUrl drops any left), and the publication time the page states
// (article:published_time, which the WSJ, NYT and The Economist set).
function bookmarklet(origin) {
  const code = `(function(){var O=${JSON.stringify(origin)};`
    + 'if(location.origin===O){alert("Open a news article first, then click this bookmark.");return}'
    + 'function T(e){return e?String(e.innerText||"").trim():""}'
    + 'function M(q){var e=document.querySelector(q);return e?String(e.getAttribute("content")||e.getAttribute("datetime")||"").trim():""}'
    + 'var s=String(window.getSelection?getSelection():"").trim(),a="";'
    + '[].forEach.call(document.querySelectorAll("article"),function(e){var x=T(e);if(x.length>a.length)a=x});'
    + `var m=T(document.querySelector("main")),t=s.length>=${CLIP_MIN_CHARS}?s:a.length>=500?a:m.length>=500?m:T(document.body);`
    + 'var h=document.querySelector(\'meta[property="og:title"]\');'
    + 'var p=M(\'meta[property="article:published_time"]\')||M(\'meta[name="article:published_time"]\')||M(\'meta[itemprop="datePublished"]\')||M(\'meta[name="parsely-pub-date"]\')||M("article time[datetime]");'
    + 'var u=location.href,c=document.querySelector(\'link[rel="canonical"]\');'
    + 'try{if(c&&c.href&&new URL(c.href).origin===location.origin)u=c.href}catch(_){}'
    + 'var d={url:u,title:String((h&&h.content)||document.title||"").trim().slice(0,400),text:t.slice(0,40000),outlet:location.hostname.replace(/^www\\./,""),published:p.slice(0,40)};'
    + 'var w=window.open(O+"/news-clip","newsdeskclip","width=620,height=720");'
    + 'if(!w){alert("News Desk: allow pop-ups on this site, then click the bookmark again.");return}'
    + 'function f(e){if(e.source===w&&e.origin===O&&e.data==="news-clip-ready"){removeEventListener("message",f);w.postMessage(d,O)}}'
    + 'addEventListener("message",f)})()'
  return `javascript:${encodeURIComponent(code)}`
}

const CLIP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clip to News Desk</title>
<style>
:root { color-scheme: light dark; --bg: #0f1115; --card: #171a21; --text: #e8eaf0; --muted: #9aa3b2; --line: #2a2f3a; --accent: #8fa8ff; --on-accent: #0f1115; --good: #5fc28a; --warn: #e0a64a; }
@media (prefers-color-scheme: light) { :root { --bg: #f6f7f9; --card: #ffffff; --text: #1d2330; --muted: #5b6474; --line: #dde1e8; --accent: #3552c8; --on-accent: #ffffff; --good: #1f7a4a; --warn: #9a5b00; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 20px 16px 32px; }
h1 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; font-weight: 600; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.small { font-size: 12px; color: var(--muted); }
.title { font-size: 18px; font-weight: 650; margin: 4px 0 6px; overflow-wrap: anywhere; }
.preview { font-size: 13px; color: var(--muted); margin: 10px 0 0; max-height: 7.5em; overflow: hidden; overflow-wrap: anywhere; }
.row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
button { font: inherit; font-size: 14px; border-radius: 8px; padding: 8px 16px; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--text); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
#status { margin: 0 0 12px; }
.warn { color: var(--warn); } .good { color: var(--good); }
ul { padding-left: 18px; margin: 8px 0 0; } li { margin-bottom: 4px; font-size: 14px; }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Clip to News Desk</h1>
  <p id="status">Waiting for the article from the page you were reading…</p>
  <div class="card" id="card" hidden>
    <div class="small" id="outlet"></div>
    <div class="title" id="title"></div>
    <div class="small" id="meta"></div>
    <p class="preview" id="preview"></p>
    <div class="row"><button class="primary" id="send" type="button">Send for a full read</button><button id="cancel" type="button">Cancel</button></div>
  </div>
  <div class="card" id="result" hidden></div>
  <p class="small">Nothing is sent until you press Send. The text goes only to the dashboard on this computer, which reads it with Claude within the day's budget.</p>
  <p class="small"><a href="/?view=news" target="_blank" rel="noopener">Open the News Desk</a></p>
</main>
<script nonce="__NONCE__">
(function () {
  var opener = window.opener, clip = null, sent = false;
  function $(id) { return document.getElementById(id); }
  function say(text, cls) { var s = $('status'); s.textContent = text; s.className = cls || ''; }
  function add(parent, tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; parent.appendChild(el); return el; }
  if (!opener) {
    say('This window works only when the Clip to News Desk bookmark opens it from an article. If the bookmark did open it, the news site cut the link between the two windows: copy the article and paste it into the News Desk tab instead.', 'warn');
    return;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== opener || clip || sent) return;
    var d = e.data, u;
    if (!d || typeof d !== 'object' || typeof d.url !== 'string' || typeof d.text !== 'string') return;
    try { u = new URL(d.url); } catch (_) { return; }
    if (!/^https?:$/.test(u.protocol) || u.origin !== e.origin) { say('The page that sent this does not match its own address, so it was ignored.', 'warn'); return; }
    clip = { url: d.url, title: String(d.title || '').slice(0, 400), text: d.text.slice(0, 40000), outlet: String(d.outlet || u.hostname).slice(0, 80), published: typeof d.published === 'string' ? d.published.slice(0, 40) : '' };
    var when = Date.parse(clip.published);
    $('outlet').textContent = clip.outlet;
    $('title').textContent = clip.title || '(no headline)';
    $('meta').textContent = clip.text.length.toLocaleString('en-US') + ' characters of text' + (d.text.length > 40000 ? ' (the first 40,000 are sent)' : '')
      + (isFinite(when) ? ' · published ' + new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
    $('preview').textContent = clip.text.slice(0, 400);
    $('card').hidden = false;
    if (clip.text.trim().length < __MIN__) { $('send').disabled = true; say('Too little text came through (at least __MIN__ characters are needed): select the article text on the page and click the bookmark again.', 'warn'); }
    else say('Check that this is the article, then press Send.');
  });
  opener.postMessage('news-clip-ready', '*');
  $('cancel').onclick = function () { window.close(); };
  $('send').onclick = function () {
    if (!clip || sent) return;
    sent = true;
    $('send').disabled = true; $('cancel').disabled = true;
    say('Reading it in full: this takes up to a minute.');
    fetch('/api/news-desk/clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clip) })
      .then(function (r) { return r.json().catch(function () { return { error: 'the server answered HTTP ' + r.status }; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) { show(x.status, x.j); })
      .catch(function (err) { say('The clip failed: ' + err.message, 'warn'); $('cancel').disabled = false; });
  };
  function show(status, j) {
    $('cancel').disabled = false; $('cancel').textContent = 'Close';
    if (status === 403) { say('The dashboard takes clips only from a browser on the computer it runs on.', 'warn'); return; }
    if (status >= 400 || !j || j.error) { say('The clip failed: ' + ((j && j.error) || ('HTTP ' + status)), 'warn'); return; }
    var it = j.item || {}, a = it.analysis;
    say(j.message || 'Saved.', a ? 'good' : 'warn');
    if (!a) return;
    var box = $('result'); box.hidden = false; box.textContent = '';
    add(box, 'div', 'title', it.title);
    add(box, 'div', '', a.summary);
    if (a.implications && a.implications.length) {
      var ul = add(box, 'ul');
      a.implications.slice(0, 6).forEach(function (m) { add(ul, 'li', '', m.target + ' (' + m.direction + ', ' + m.confidence + ' confidence): ' + m.text); });
    }
  }
})();
</script>
</body>
</html>
`

// ── the desk ────────────────────────────────────────────────────────────────
// client: a stand-in for the Anthropic SDK client, for tests only (analyzer.js).
export function createNewsDesk({ UA, dir, FMP_KEY, ANTHROPIC_KEY, tensions, dailyUsd = 2, client } = {}) {
  if (!dir) throw new Error('createNewsDesk needs dir')
  const INSTANCE = crypto.randomBytes(4).toString('hex')
  const store = createStore({ dir })
  const meta = createMeta(dir)
  const budget = createBudget({ dir, dailyUsd })
  const analyzer = createAnalyzer({ ANTHROPIC_KEY, budget, dir, client })
  let lastProfile = null, lastProfileAt = 0
  let seenSeq = SHARED.doneSeq

  // An older instance (before a Vite restart) finished a refresh: take in what it saved.
  function catchUp() {
    if (SHARED.doneSeq === seenSeq) return
    seenSeq = SHARED.doneSeq
    if (SHARED.doneBy !== INSTANCE) { store.save(); meta.load() }
  }

  async function currentProfile({ reuse = false } = {}) {
    if (reuse && lastProfile && Date.now() - lastProfileAt < 6 * HOUR) return lastProfile
    const p = await buildProfile({ dir, UA, FMP_KEY, tensions })
    // a board that is slow to build must not change the prompt (and so the prompt cache)
    if (p.tensions.length) meta.data.tensions = p.tensions
    else if (meta.data.tensions?.length) p.tensions = meta.data.tensions
    lastProfile = p; lastProfileAt = Date.now()
    return p
  }

  // The payload's light profile: no network, so the GET answers at once.
  function quickProfile() {
    const cache = readJsonSafe(path.join(dir, 'news-profile.json'))
    const names = cache.state === 'ok' && cache.data?.tickers && typeof cache.data.tickers === 'object' ? cache.data.tickers : {}
    const tens = lastProfile?.tensions?.length ? lastProfile.tensions : meta.data.tensions || []
    return {
      tickers: readWatchlist(dir).sort().map(symbol => ({ symbol, name: oneLine(names[symbol]?.name, 120) || symbol })),
      categories: loadCategories(dir).map(({ id, label, description }) => ({ id, label, description })),
      tensions: tens.map(({ id, title, domain }) => ({ id, title, domain })),
    }
  }

  const inWindow = (it, since = Date.now() - WINDOW_DAYS * DAY) => isClip(it) || timeOf(it) >= since

  // ── triage ──
  const gaveUp = id => (meta.data.triageFailures?.[id] || 0) >= TRIAGE_MAX_TRIES
  function untriaged() {
    const since = Date.now() - WINDOW_DAYS * DAY
    return store.all()
      .filter(it => !it.triage && inWindow(it, since) && !gaveUp(it.id))
      .sort((a, b) => isClip(b) - isClip(a) || (b.kind === 'filing') - (a.kind === 'filing') || timeOf(b) - timeOf(a))
  }
  // unscored items of the past week that Claude failed on twice (or refused)
  const unscorable = () => { const since = Date.now() - WINDOW_DAYS * DAY; return store.all().filter(it => !it.triage && inWindow(it, since) && gaveUp(it.id)).length }
  // story keys in use, newest last, so a new item joins its story
  function recentClusters() {
    const seen = new Set(), out = []
    for (const it of store.all()) {
      const c = it.triage?.cluster
      if (c && !seen.has(c)) { seen.add(c); out.push(c); if (out.length >= 200) break }
    }
    return out.reverse()
  }
  // res.errors holds only failures that are the items' own (analyzer.js): an
  // outage (.outage) charges nothing, and a refusal is final.
  function applyTriage(res) {
    meta.data.triageFailures ||= {}
    for (const r of res) {
      const { id, ...tr } = r
      store.update(id, { triage: tr })
      delete meta.data.triageFailures[id]
    }
    for (const e of res.errors || []) {
      for (const id of e.ids || []) meta.data.triageFailures[id] = e.final ? TRIAGE_MAX_TRIES : (meta.data.triageFailures[id] || 0) + 1
    }
  }

  // ── deep reads ──
  function related(it) {
    const c = it?.triage?.cluster
    if (!c) return []
    return store.all().filter(x => x.id !== it.id && x.triage?.cluster === c).slice(0, 8)
  }
  // A re-read must not lose what the user decided about the old proposals.
  function carryProposals(oldA, newA) {
    const decided = (oldA?.proposals || []).filter(p => p && p.status && p.status !== 'pending')
    if (!decided.length) return newA
    const key = p => `${p.file}|${JSON.stringify(p.row)}`
    const props = (newA.proposals || []).map(p => {
      const d = decided.find(x => key(x) === key(p))
      return d ? { ...p, status: d.status, decided: d.decided } : p
    })
    for (const d of decided) if (!props.some(p => key(p) === key(d))) props.push(d)
    return { ...newA, proposals: props }
  }
  // One deep read, stored. → { ok, usd, code?, message?, basis?, shared? }
  // Only one read of an item runs at a time, across both instances
  // (SHARED.reading): a second caller waits for it and pays nothing, unless
  // the read in flight was of the headline and the item has gained text
  // since (a clip came in meanwhile), which is then read in full.
  async function readOne(id, profile) {
    for (;;) {
      const busy = SHARED.reading.get(id)
      if (!busy) break
      const prev = await busy
      // the read may have run on the instance before a Vite restart: take in its analysis
      if (prev.ok && prev.analysis && !store.get(id)?.analysis) {
        store.update(id, cur => ({ analysis: carryProposals(cur.analysis, prev.analysis), error: undefined }))
      }
      const cur = store.get(id)
      if (!(cur?.analysis?.basis === 'headline' && hasText(cur))) {
        return { ok: prev.ok, code: prev.code, message: prev.message, basis: cur?.analysis?.basis || prev.basis, usd: 0, shared: true }
      }
    }
    let run = null
    run = (async () => {
      try { return await readNow(id, profile) } finally { if (SHARED.reading.get(id) === run) SHARED.reading.delete(id) }
    })()
    SHARED.reading.set(id, run)
    return run
  }
  // Failures count toward DEEP_MAX_TRIES only when they are the item's own:
  // 'invalid' and 'max_tokens' once each, a refusal at once. 'api' (Claude or
  // the account is down) is not stored on the item and leaves it for the
  // next refresh. Never rejects.
  async function readNow(id, profile) {
    const it = store.get(id)
    if (!it) return { ok: false, code: 'gone', message: 'The item is no longer stored.', usd: 0 }
    meta.data.readFailures ||= {}
    try {
      const a = await analyzer.deepRead(it, profile, related(it))
      store.update(id, cur => ({ analysis: carryProposals(cur.analysis, a), error: undefined }))
      delete meta.data.readFailures[id]
      meta.day().deepReads++
      meta.data.analysesSinceBrief = (meta.data.analysesSinceBrief || 0) + 1
      return { ok: true, usd: a.usd || 0, basis: a.basis, analysis: a }
    } catch (e) {
      const code = e.code || 'api'
      if (e.usd) meta.day().deepReads++ // a paid attempt counts toward the day's reads
      if (code === 'budget' || code === 'off' || code === 'api') return { ok: false, code, message: e.message, usd: e.usd || 0 }
      const prev = meta.data.readFailures[id]?.n || 0
      meta.data.readFailures[id] = { n: code === 'refusal' ? DEEP_MAX_TRIES : prev + 1, code, at: iso() }
      store.update(id, { error: e.message })
      return { ok: false, code, message: e.message, usd: e.usd || 0 }
    }
  }
  function pickDeepReads(n, profile) {
    if (n <= 0) return []
    const cutoff = Date.now() - DEEP_RECENT_DAYS * DAY
    const watch = new Set((profile?.tickers || []).map(t => t.symbol))
    const fails = meta.data.readFailures || {}
    const covered = new Map() // story key → the best read it has: 'full-text' or 'headline'
    for (const it of store.all()) {
      const c = it.triage?.cluster
      if (c && it.analysis && covered.get(c) !== 'full-text') covered.set(c, it.analysis.basis)
    }
    const trackedFiling = it => it.kind === 'filing' && hasText(it) && !it.textPartial && (it.tickers || []).some(s => watch.has(s))
    const cands = store.all().filter(it => {
      if (it.analysis || (fails[it.id]?.n || 0) >= DEEP_MAX_TRIES || SHARED.reading.has(it.id)) return false
      if (isClip(it)) return true
      // a filing whose text the feed does not read (10-K, 10-Q, proxies, 13G) has only its form name,
      // and one read in part (an exhibit failed) waits until feeds.js has read all of it
      if (it.kind === 'filing' && (!hasText(it) || it.textPartial)) return false
      const t = it.triage
      return t && t.relevance >= DEEP_MIN && (t.tickers?.length || t.categories?.length) && timeOf(it) >= cutoff
    }).sort((a, b) => isClip(b) - isClip(a) || trackedFiling(b) - trackedFiling(a)
      || (b.triage?.relevance ?? 0) - (a.triage?.relevance ?? 0) || timeOf(b) - timeOf(a))
    const out = [], chosen = new Set()
    for (const it of cands) {
      if (out.length >= n) break
      const c = it.triage?.cluster
      if (c) {
        if (chosen.has(c)) continue
        const have = covered.get(c)
        if (have === 'full-text' || (have && !hasText(it))) continue
        chosen.add(c)
      }
      out.push(it.id)
    }
    return out
  }

  // ── the brief ──
  // One brief per slot (BRIEF_SLOTS) and day, so briefs follow the clock
  // instead of going to the first three refreshes after midnight. A day
  // recorded before slots existed has only a count: its slot comes from the
  // brief it kept.
  function usedSlots() {
    const d = meta.day()
    if (Array.isArray(d.briefSlots)) return d.briefSlots
    const br = meta.data.brief
    const s = d.briefs && br?.day === localDay() && br.at ? slotOf(Date.parse(br.at)) : null
    return s == null ? [] : [s]
  }
  const markSlot = slot => { const d = meta.day(); d.briefSlots = [...new Set([...usedSlots(), slot])] }
  async function writeBrief(profile, slot) {
    const since = Date.now() - BRIEF_HOURS * HOUR
    const pool = store.all().filter(it => {
      const fresh = timeOf(it) >= since || (it.analysis && Date.parse(it.analysis.at) >= since)
      if (!fresh) return false
      if (it.analysis) return true
      const t = it.triage
      return t && t.relevance >= BRIEF_MIN_REL && (t.tickers?.length || t.categories?.length)
    })
    try {
      const b = await analyzer.brief(pool, profile)
      meta.data.brief = { ...b, day: localDay() }
      meta.day().briefs++
      markSlot(slot)
      meta.data.analysesSinceBrief = 0
      return { ok: true, usd: b.usd || 0 }
    } catch (e) {
      if (e.usd) { meta.day().briefs++; markSlot(slot) } // a paid failure uses up the slot
      return { ok: false, code: e.code || 'api', message: e.message, usd: e.usd || 0 }
    }
  }

  // ── the cycle ──
  async function cycle({ reason = 'manual', maxTriage = TRIAGE_PER_REFRESH, maxDeep = DEEP_PER_REFRESH } = {}) {
    const t0 = Date.now()
    const sum = {
      at: iso(t0), reason, done: null, ok: false, fetched: 0, added: 0, feedsDown: 0,
      triaged: 0, waiting: 0, deepReads: 0, deepFailed: 0, brief: false, usd: 0, budget: null, outage: null, quiet: null, errors: [],
    }
    // the hourly timer and a page view only score at night; the Refresh button does everything
    const quiet = (reason === 'hourly' || reason === 'opened') && isQuiet()
    const outage = msg => {
      if (sum.outage) return
      sum.outage = msg
      sum.errors.push(`Claude could not be reached, so this refresh stopped spending after one failed call: ${msg} Nothing was counted against the items; the next refresh tries again.`)
    }
    const stage = s => { SHARED.progress = { stage: s, since: sum.at, reason } }
    meta.data.lastAttempt = sum.at
    meta.save()
    let finished = false
    try {
      stage('reading the watchlist')
      const profile = await currentProfile()
      stage('reading the feeds')
      const { items, health } = await fetchAll({ UA, FMP_KEY, profile, known: id => store.get(id) })
      meta.data.health = health
      sum.fetched = items.length
      sum.feedsDown = health.filter(h => !h.ok).length
      sum.added = store.upsert(items).added.length

      if (analyzer.enabled) {
        const todo = untriaged().slice(0, Math.max(0, maxTriage))
        if (todo.length) {
          stage(`scoring ${plural(todo.length, 'new item')}`)
          const res = await analyzer.triage(todo, profile, { clusters: recentClusters() })
          applyTriage(res)
          sum.triaged = res.length
          sum.usd += res.usd || 0
          if (res.budget) sum.budget = res.budget
          if (res.outage) outage(res.outage)
          const failed = (res.errors || []).reduce((n, e) => n + (e.ids?.length || 0), 0)
          if (failed) sum.errors.push(`${plural(failed, 'item')} could not be scored: ${res.errors[0].error}`)
          if (res.unsplit) sum.errors.push(`${plural(res.unsplit, 'item')} could not be scored this time and wait for the next refresh: ${res.unsplitError}`)
        }
        sum.waiting = untriaged().length
      }
      if (quiet) sum.quiet = `Between ${hourLabel(QUIET_FROM)} and ${hourLabel(QUIET_TO)} the automatic refresh only scores: deep reads resume at ${hourLabel(QUIET_TO)}, and the next brief comes after ${hourLabel(BRIEF_SLOTS[0])}.`

      if (analyzer.enabled && !sum.budget && !sum.outage && !quiet) {
        const room = Math.max(0, Math.min(maxDeep, DEEP_PER_DAY - meta.day().deepReads))
        const picks = pickDeepReads(room, profile)
        let k = 0
        for (const id of picks) {
          // a clip got there first, or is reading it now
          if (store.get(id)?.analysis || SHARED.reading.has(id)) continue
          stage(`reading ${++k} of ${picks.length} in depth`)
          const r = await readOne(id, profile)
          sum.usd += r.usd || 0
          if (r.shared) continue
          if (r.ok) sum.deepReads++
          else if (r.code === 'budget' || r.code === 'off') { sum.budget = r.message; break }
          else if (r.code === 'api') { outage(r.message); break }
          else { sum.deepFailed++; sum.errors.push(`A deep read failed: ${r.message}`) }
        }
        meta.save()
      }

      const slot = slotOf()
      if (analyzer.enabled && !sum.budget && !sum.outage && !quiet && slot != null && !usedSlots().includes(slot)
        && (meta.data.analysesSinceBrief || 0) > 0 && meta.day().briefs < BRIEF_PER_DAY) {
        stage('writing the brief')
        const r = await writeBrief(profile, slot)
        sum.usd += r.usd || 0
        if (r.ok) sum.brief = true
        else if (r.code === 'budget') sum.budget = r.message
        else if (r.code === 'api') outage(r.message)
        else sum.errors.push(`The brief failed: ${r.message}`)
      }

      stage('saving')
      store.prune(KEEP_DAYS)
      // forget failure counts for items no longer stored
      for (const k of ['readFailures', 'triageFailures']) for (const id of Object.keys(meta.data[k] || {})) if (!store.get(id)) delete meta.data[k][id]
      sum.ok = store.save()
      if (!sum.ok) sum.errors.push(`news-desk.json was not saved: ${store.stats().lastError}`)
      finished = true
    } catch (e) {
      sum.errors.push(`The refresh stopped: ${e.message}`)
      console.error(`News desk: refresh failed: ${e.stack || e.message}`)
      try { store.save() } catch { /* reported by store.stats() */ }
    }
    sum.done = iso()
    sum.usd = Math.round(sum.usd * 1e6) / 1e6
    if (finished) meta.data.built = sum.done
    meta.data.lastRun = sum
    meta.save()
    console.log(`[news-desk] refresh (${reason}): ${sum.fetched} items read, ${sum.added} new, ${sum.triaged} scored, ${sum.deepReads} read in depth${sum.brief ? ', brief written' : ''}, $${sum.usd.toFixed(4)} in ${((Date.now() - t0) / 1000).toFixed(1)} s${sum.errors.length ? `; ${sum.errors.length} problem(s)` : ''}`)
    return sum
  }

  function refresh(opts = {}) {
    catchUp()
    if (SHARED.running) return SHARED.running
    const run = cycle(opts) // never rejects
    SHARED.running = run
    SHARED.progress = { stage: 'starting', since: iso(), reason: opts.reason || 'manual' }
    run.then(() => {
      if (SHARED.running !== run) return
      SHARED.running = null; SHARED.progress = null
      SHARED.doneSeq++; SHARED.doneBy = INSTANCE
      seenSeq = SHARED.doneSeq
    })
    return run
  }

  // ── clips ──
  const SITE_SUFFIX = /\s+[-|–—]\s+(WSJ|The Wall Street Journal|The New York Times|NYTimes\.com|The Economist|Barron's|Financial Times|Bloomberg)\s*$/i
  // The page's own publication time, when it parses and is not in the future;
  // else null (the clip is then dated when it was clipped).
  function clipDate(v) {
    const t = Date.parse(typeof v === 'string' ? v.trim().slice(0, 40) : '')
    return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t <= Date.now() + 10 * MIN ? iso(Math.min(t, Date.now())) : null
  }
  async function clip(body) {
    // whitespace collapsed as analyzer.js does before it measures the text, so
    // a clip accepted here is always read in full
    const text = String(body.text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ \n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length < CLIP_MIN_CHARS) throw httpError(400, `A clip needs at least ${CLIP_MIN_CHARS} characters of the article's text; this one has ${text.length}.`)
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
    if (rawUrl && !/^https?:\/\/[^\s]+$/i.test(rawUrl)) throw httpError(400, 'The URL should start with http:// or https://.')
    const url = rawUrl ? cleanUrl(rawUrl) : null
    let host = null
    try { host = url ? new URL(url).hostname.replace(/^www\./, '') : null } catch { /* left null */ }
    const info = url ? siteInfo(url) : null
    const id = url ? idForUrl(url) : sha16(`clip:${text.slice(0, 4000)}`)
    const prev = store.get(id)
    const firstLine = oneLine(text.split('\n')[0], 160)
    const now = iso()
    // a feed copy's date stands; otherwise the date the page gives, else now
    const stated = clipDate(body.published)
    store.upsert([{
      id, url, title: prev?.title || oneLine(body.title, 400).replace(SITE_SUFFIX, '') || firstLine, dek: null,
      source: 'clip', outlet: info?.outlet || oneLine(body.outlet, 80) || host || 'Clip', section: null,
      published: prev?.published || stated || now, fetched: now, clipped: now, kind: 'clip', paywalled: Boolean(info?.paywalled),
      tickers: [], text: text.slice(0, TEXT_CAP),
    }])
    // store.js keeps the first date it saw: a clip clipped again may correct its own
    if (stated && prev && isClip(prev) && prev.published !== stated) store.update(id, { published: stated })
    const done = (message, extra = {}) => { store.save(); meta.save(); return { ok: true, item: strip(store.get(id)), message, ...extra } }
    if (!analyzer.enabled) return done(`Saved. ${analyzer.reason}`)
    // the same text clipped again, already read in full: nothing to pay for
    const had = store.get(id)
    if (prev?.analysis?.basis === 'full-text' && prev.text === had.text && !SHARED.reading.has(id)) {
      return done(`Already read in full on ${new Date(Date.parse(prev.analysis.at) || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}; it is on the News Desk under Your clips.`, { usd: 0 })
    }
    const profile = await currentProfile({ reuse: true })
    let usd = 0
    if (!store.get(id).triage) {
      // triage reads a headline and summary; a clip has no summary, so it gets its opening lines
      const it = store.get(id)
      const res = await analyzer.triage([{ ...it, dek: it.dek || oneLine(it.text, 600) }], profile, { clusters: recentClusters() })
      applyTriage(res)
      usd += res.usd || 0
      if (res.budget) return done(`Saved. ${res.budget} The first refresh after that reads it in full.`, { usd })
      if (res.outage) return done(`Saved, but Claude could not be reached: ${res.outage} The next refresh reads it in full.`, { usd })
    }
    const r = await readOne(id, profile)
    usd += r.usd || 0
    if (r.ok) {
      const { t, c } = targetsOf(store.get(id))
      const where = t.size + c.size ? 'under Your clips and under its holding or category' : 'under Your clips'
      const how = r.basis === 'full-text' ? 'Read in full' : 'Read from its headline only'
      return done(`${how}${r.shared ? '' : ` for ${money(usd)}`}; the analysis is on the News Desk ${where}.`, { usd })
    }
    if (r.code === 'budget') return done(`Saved. ${r.message} The first refresh after that reads it in full.`, { usd })
    if (r.code === 'api') return done(`Saved, but Claude could not be reached: ${r.message} The next refresh reads it in full.`, { usd })
    return done(`Saved, but the read failed: ${r.message}`, { usd })
  }

  // ── proposals ──
  function decide(body) {
    const it = store.get(String(body.itemId || ''))
    if (!it) throw httpError(404, 'That item is no longer stored.')
    const list = it.analysis?.proposals
    const i = Number(body.index)
    if (!Array.isArray(list) || !Number.isInteger(i) || i < 0 || i >= list.length) throw httpError(404, 'That proposal is no longer there.')
    const action = String(body.action || '').toLowerCase()
    const status = action === 'approve' || action === 'approved' ? 'approved' : action === 'dismiss' || action === 'dismissed' ? 'dismissed' : null
    if (!status) throw httpError(400, 'action must be approve or dismiss.')
    const p = list[i]
    if (p.status !== 'pending') throw httpError(409, `That proposal was already ${p.status}.`)
    const written = status === 'approved' ? appendRow(dir, p.file, p.row) : null
    store.update(it.id, cur => ({
      analysis: { ...cur.analysis, proposals: cur.analysis.proposals.map((q, k) => (k === i ? { ...q, status, decided: iso() } : q)) },
    }))
    store.save()
    return { ok: true, status, written }
  }

  // ── the payload ──
  function strip(it) {
    if (!it) return null
    const { text, ...rest } = it
    if (typeof text === 'string' && text.length) rest.textChars = text.length
    if (!it.triage && gaveUp(it.id)) rest.triageGaveUp = true
    return rest
  }
  // The holdings and categories an item belongs under, each marked 'direct'
  // or with the confidence of the implication that alone puts it there.
  // Direct: triage named the target at a relevant score (or named it and the
  // deep read confirms it), or, unscored, the source tagged the ticker; an
  // item read in depth but never scored counts its implications as direct.
  // Second-order: only a deep read's implication names the target (a
  // supplier's results bearing on its customer); such items sit below the direct ones
  // on a card, and the tab labels them "via" the item's own subject.
  function targetsOf(it) {
    const t = new Map(), c = new Map()
    const tr = it.triage
    const imps = it.analysis?.implications || []
    const confirmed = key => imps.some(m => m.target === key)
    if (tr) {
      for (const s of tr.tickers || []) if (tr.relevance >= REL_MIN || confirmed(s)) t.set(s, 'direct')
      for (const k of tr.categories || []) if (tr.relevance >= REL_MIN || confirmed(k)) c.set(k, 'direct')
    } else if (!it.analysis) for (const s of it.tickers || []) t.set(s, 'direct') // unscored: the source's own ticker tag
    for (const m of imps) {
      const map = m.targetType === 'category' ? c : t
      if (!map.has(m.target)) map.set(m.target, tr ? m.confidence || 'low' : 'direct')
    }
    return { t, c }
  }
  const CONF_RANK = { direct: 0, high: 1, medium: 2, low: 3 }
  function notesFor({ local, counts, b }) {
    const notes = []
    const lr = meta.data.lastRun
    if (!analyzer.enabled) notes.push(analyzer.reason)
    if (b.paused) notes.push(b.paused)
    if (lr?.done) {
      const parts = [`${plural(lr.fetched, 'item')} read from the feeds, ${lr.added.toLocaleString('en-US')} new`]
      if (analyzer.enabled) parts.push(`${lr.triaged.toLocaleString('en-US')} scored`, `${lr.deepReads} read in depth${lr.brief ? ', brief rewritten' : ''}`, `${money(lr.usd)} of Claude`)
      notes.push(`Last refresh at ${clock(Date.parse(lr.done))}: ${parts.join('; ')}.`)
      if (lr.budget) notes.push(lr.budget)
      if (lr.quiet) notes.push(lr.quiet)
      for (const e of (lr.errors || []).slice(0, 3)) notes.push(e)
    }
    if (analyzer.enabled && counts.waiting) notes.push(`${plural(counts.waiting, 'item')} from the past week ${counts.waiting === 1 ? 'is' : 'are'} waiting to be scored; the next refresh takes them.`)
    if (analyzer.enabled && counts.unscorable) notes.push(`${plural(counts.unscorable, 'item')} from the past week could not be scored: Claude refused ${counts.unscorable === 1 ? 'it' : 'them'} or failed on ${counts.unscorable === 1 ? 'it' : 'them'} twice.`)
    if (analyzer.enabled) {
      const d = meta.day()
      notes.push(`Deep reads today: ${d.deepReads} of ${DEEP_PER_DAY}. Briefs today: ${d.briefs} of ${BRIEF_PER_DAY}. Claude so far today: ${money(b.spent)} of ${money(b.cap)}.`)
    }
    const viewed = Date.parse(meta.data.lastViewed) || 0
    const slots = BRIEF_SLOTS.map(hourLabel)
    notes.push(Date.now() - viewed < VIEWED_WITHIN
      ? `The desk refreshes itself every hour while it has been opened on this computer in the past day; between ${hourLabel(QUIET_FROM)} and ${hourLabel(QUIET_TO)} it only scores. A brief is written after ${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]} when there are new deep reads.`
      : 'The desk refreshes itself hourly only after it has been opened on this computer; it has not been in the past day.')
    const st = store.stats()
    if (st.corrupt) notes.push(`news-desk.json could not be read on ${st.corrupt.at.slice(0, 10)} and was set aside as ${st.corrupt.file}; the desk started again.`)
    if (st.loadError) notes.push(`news-desk.json cannot be read (${st.loadError}); nothing is saved until it can be.`)
    else if (st.lastError) notes.push(st.lastError)
    if (!local) notes.push('Read only from this device: refresh, clips and approvals work only in a browser on the computer running the dashboard.')
    return notes
  }

  function get(req) {
    catchUp()
    const local = fromLoopback(req)
    const q = new URL(req?.url || '/', 'http://x').searchParams
    const scripted = q.get('auto') === '0'
    // only the tab opening (isView) counts as a view and may start a refresh
    if (!scripted && isView(req)) {
      meta.data.lastViewed = iso()
      meta.saveSoon()
      const last = Math.max(Date.parse(meta.data.lastAttempt) || 0, Date.parse(meta.data.built) || 0)
      if (!SHARED.running && Date.now() - last > AUTO_AFTER) refresh({ reason: 'opened' })
    }

    const profile = quickProfile()
    const syms = new Set(profile.tickers.map(t => t.symbol)), cats = new Set(profile.categories.map(c => c.id))
    const since = Date.now() - WINDOW_DAYS * DAY, midnight = startOfToday()
    const all = store.all()
    const win = all.filter(it => inWindow(it, since))
    const rel = it => it.triage?.relevance ?? -1
    const ordered = win.slice().sort((a, b) => rel(b) - rel(a) || timeOf(b) - timeOf(a))
    // per card: direct items by score, then second-order ones by confidence
    const groupsT = {}, groupsC = {}
    let relevant = 0
    for (const it of ordered) {
      const { t, c } = targetsOf(it)
      if ((it.triage || it.analysis) && t.size + c.size) relevant++
      for (const [s, how] of t) if (syms.has(s)) (groupsT[s] ||= []).push({ id: it.id, rank: CONF_RANK[how] ?? 3 })
      for (const [k, how] of c) if (cats.has(k)) (groupsC[k] ||= []).push({ id: it.id, rank: CONF_RANK[how] ?? 3 })
    }
    const card = list => list.map((x, i) => ({ ...x, i })).sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, GROUP_MAX).map(x => x.id)
    const byTicker = Object.fromEntries(Object.entries(groupsT).map(([k, v]) => [k, card(v)]))
    const byCategory = Object.fromEntries(Object.entries(groupsC).map(([k, v]) => [k, card(v)]))
    const ids = new Set([...Object.values(byTicker).flat(), ...Object.values(byCategory).flat()])
    for (const it of all) if (isClip(it)) ids.add(it.id)

    const br = meta.data.brief
    const brief = br && Date.now() - Date.parse(br.at) < BRIEF_HOURS * HOUR ? br : null
    for (const s of brief?.sections || []) for (const id of s.itemIds || []) ids.add(id)

    const proposals = []
    for (const it of all) {
      (it.analysis?.proposals || []).forEach((p, index) => {
        if (!p || (p.status !== 'pending' && !inWindow(it, since))) return
        proposals.push({ itemId: it.id, index, file: p.file, row: p.row, evidence: p.evidence, quoted: p.quoted !== false, status: p.status })
        ids.add(it.id)
      })
    }

    const counts = {
      items: win.length,
      today: win.filter(it => timeOf(it) >= midnight).length,
      relevant,
      analysed: win.filter(it => it.analysis).length,
      clips: all.filter(isClip).length,
      waiting: analyzer.enabled ? untriaged().length : 0,
      unscorable: analyzer.enabled ? unscorable() : 0,
    }
    // canDeepRead: whether today's budget still allows a deep read or a brief
    // (the server stops each call that would not fit under the cap, so
    // "spent" alone never quite reaches it)
    const b = budget.today()
    b.deepEstimate = analyzer.enabled ? Math.round(analyzer.deepEstimate() * 1e4) / 1e4 : null
    b.canDeepRead = analyzer.enabled && !b.paused && budget.canSpend(analyzer.deepEstimate())
    const d = meta.day()
    const port = req?.socket?.localPort || 5180
    return {
      built: meta.data.built,
      lastAttempt: meta.data.lastAttempt,
      refreshing: Boolean(SHARED.running),
      refresh: SHARED.running ? SHARED.progress : null,
      analysisOn: analyzer.enabled,
      analysisReason: analyzer.reason,
      budget: b,
      limits: {
        relevantMin: REL_MIN, deepMin: DEEP_MIN, deepPerDay: DEEP_PER_DAY, deepToday: d.deepReads, briefsPerDay: BRIEF_PER_DAY, briefsToday: d.briefs,
        windowDays: WINDOW_DAYS, clipMinChars: CLIP_MIN_CHARS, briefHours: BRIEF_SLOTS, quietHours: [QUIET_FROM, QUIET_TO],
      },
      counts,
      brief,
      items: [...ids].map(id => strip(store.get(id))).filter(Boolean),
      byTicker,
      byCategory,
      proposals,
      profile,
      health: meta.data.health || [],
      notes: notesFor({ local, counts, b }),
      bookmarklet: bookmarklet(`http://localhost:${port}`),
      lastRun: meta.data.lastRun,
      local,
    }
  }

  // ── routes ──
  async function handle(req, res) {
    let pathname = '/'
    try {
      pathname = new URL(req.url || '/', 'http://x').pathname.replace(/\/+$/, '') || '/'
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (pathname !== '/') return sendJson(res, 404, { error: 'There is no such News Desk route.' })
        return sendJson(res, 200, get(req))
      }
      if (req.method !== 'POST') { req.resume?.(); res.setHeader('Allow', 'GET, POST'); return sendJson(res, 405, { error: 'GET or POST only.' }) }
      if (!fromLoopback(req) || !sameOrigin(req)) { req.resume?.(); return sendJson(res, 403, { error: LOCAL_ONLY }) }
      if (pathname === '/refresh') {
        const body = await readJsonBody(req, SMALL_BODY_MAX)
        const opts = { reason: 'button' }
        if (Number.isInteger(body.maxTriage) && body.maxTriage >= 0) opts.maxTriage = Math.min(body.maxTriage, TRIAGE_PER_REFRESH)
        if (Number.isInteger(body.maxDeep) && body.maxDeep >= 0) opts.maxDeep = Math.min(body.maxDeep, DEEP_PER_REFRESH)
        const already = Boolean(SHARED.running)
        const run = refresh(opts)
        if (body.wait === true) return sendJson(res, 200, { ok: true, refreshing: false, already, summary: await run })
        return sendJson(res, 202, { ok: true, refreshing: true, already, since: SHARED.progress?.since || null })
      }
      if (pathname === '/clip') return sendJson(res, 200, await clip(await readJsonBody(req, CLIP_BODY_MAX)))
      if (pathname === '/proposal') return sendJson(res, 200, decide(await readJsonBody(req, SMALL_BODY_MAX)))
      req.resume?.()
      return sendJson(res, 404, { error: 'There is no such News Desk route.' })
    } catch (e) {
      const status = e?.status >= 400 && e.status < 600 ? e.status : 500
      if (status === 500) console.error(`News desk: ${req.method} ${pathname}: ${e?.stack || e?.message}`)
      if (!res.headersSent) sendJson(res, status, { error: e?.message || 'The News Desk failed.' })
      else res.end()
    }
  }

  function clipPage(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(); return }
    const nonce = crypto.randomBytes(16).toString('base64')
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(CLIP_HTML.replace('__NONCE__', nonce).replaceAll('__MIN__', String(CLIP_MIN_CHARS)))
  }

  // ── the background refresh ──
  function tick() {
    const viewed = Date.parse(meta.data.lastViewed) || 0
    const last = Math.max(Date.parse(meta.data.lastAttempt) || 0, Date.parse(meta.data.built) || 0)
    if (Date.now() - viewed > VIEWED_WITHIN || SHARED.running || Date.now() - last < TIMER_EVERY) return
    refresh({ reason: 'hourly' })
  }
  SHARED.stop?.() // the instance before a Vite restart
  const timer = setInterval(tick, TIMER_TICK)
  timer.unref?.()
  function stop() {
    clearInterval(timer)
    if (SHARED.stop === stop) SHARED.stop = null
  }
  SHARED.stop = stop

  return { get, handle, clipPage, refresh, stop }
}
