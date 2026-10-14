// ============================================================================
// CEF DISCOUNTS: closed-end funds, a discount screener and the data behind its
// backtest. A fund at an unusually wide discount to NAV against its own history
// tends to see the discount narrow (Pontiff 1995); discounts also tend to widen
// into the November-December tax-loss season and narrow in January.
//   snapshot   CEFConnect (Nuveen; the fund data is Morningstar's),
//              www.cefconnect.com/api/v3/DailyPricing: one row per listed fund
//              (~360) with price, NAV, discount, CEFConnect's 3-month, 6-month
//              and 1-year discount z-scores, distribution rate and policy,
//              earnings, UNII, leverage, expenses, size, volume and returns.
//              Price is the last close (LastUpdated); NAV is the latest published
//              (NAVPublished), usually the day before, and monthly or quarterly
//              for a few funds (CLO equity, private-asset funds: navStale).
//   disc       price over NAV on the same day, (P / NAV - 1) × 100, negative = a
//              discount. On the NAV date the price is the archived close or, when
//              none was seen, the one implied by CEFConnect's Discount field, which
//              for daily-NAV funds is exactly that figure (priceForNav). For a NAV
//              over 7 days old (navStale) disc is today's price over that NAV:
//              CEFConnect's Discount then moves with the price day to day, so it
//              does not give the price on the NAV date. discNow sets today's close
//              against the last NAV, mixing days.
//   history    /api/v3/pricinghistory/{T}/5Y: weekly price and NAV over five years
//              (Fridays, the odd week missing). 1Y is daily but sometimes only a
//              few days long; All is weekly since inception. Its DiscountData
//              field (positive = premium) is ignored: discounts are recomputed
//              from price and NAV everywhere. Weeks after the last fetched one are
//              filled from the daily archive (the last day of each week).
//   dists      /api/v3/distributionhistory/fund/{T}/{from}/{to}, MM-DD-YYYY: each
//              distribution's ex, pay and declared dates and its split into
//              income, return of capital, long- and short-term gains and special.
//              The split is the fund's Section 19(a) estimate when it was paid,
//              not the final tax character from the year-end 1099.
// Derived
//   pct5y      today's disc as a percentile of the fund's own weekly discounts over
//              five years (share below, ties half; low = unusually wide)
//   roc12      return of capital ÷ all distributions gone ex in the past 365 days
//   coverage   EarningsPerShare ÷ six months of the current distribution. CEFConnect
//              shows the field as "Avg. Earnings Per Share, as of" a fiscal half-year
//              end: net investment income per share over the half-year of the last
//              shareholder report (NAD: 0.2798 ÷ (6 × 0.0705) = 66%; its 19(a)
//              income share is 65%). Up to a year old; the API gives no as-of date.
//   universe   each week, the median and quartiles of all funds' discounts
//   seasonality  the change in discount (points) over each calendar month, from
//              month-end weekly points, every fund and year; the month in progress
//              is left out
//   panel      per fund, aligned to months: disc (last weekly point of the month),
//              z (disc against the fund's weekly discounts in the 52 weeks to that
//              point, 26 needed: what was known then), rel (disc less the median of
//              its CEFConnect category that month, 3 funds needed, else of its
//              family), tr (month-end price plus distributions gone ex after last
//              month-end, over last month-end's price, less 1; not reinvested; null
//              when price and NAV both jump 1.8× or more, a split, or when the
//              month's distributions are unknown), px (month-end price). The last
//              month is usually in progress (panel.lastPartial). Some months end on
//              an earlier Friday: CEFConnect's weekly series skips holiday weeks and
//              the odd month-end Friday (PDI: 17 of 261 weeks). Compounded over
//              Oct 2025-Sep 2026, tr matches CEFConnect's ReturnOnPrice (which is as
//              of the last month-end) with a correlation of 0.99 across 332 funds.
// Cadence: stale-while-revalidate. The snapshot is refetched when over 6 hours
// old; the first GET with none on disk waits for it (CEFConnect takes 1-20 s and
// now and then hangs, so 60 s timeout and three tries). A background worker
// backfills the weekly history and five years of distributions of every listed
// fund, largest first: 2 requests in flight, starting at least 400 ms apart, a
// 429 holds every request for its Retry-After, progress saved every 20 funds so
// a restart resumes. The endpoint answers at once with what exists and backfill:
// { done, total, failed, running } (plus the first full pass's start, finish and
// ms); a fund that failed is retried after 30 minutes. After that first pass, a
// run (at most every 6 hours) refetches the 5Y series of up to 40 funds whose last
// weekly point is over 14 days old and the distributions (past 400 days) of up to
// 40 last fetched over 30 days ago. Unknown tickers answer {"Data":null} (history:
// taken as none) or an HTML "Site Unavailable" page (distributions: an error). For
// a few funds one bad record turns every distribution range that includes it into
// that page (BPRE, Sept-Nov 2025): those are fetched by quarter instead and the
// quarters that fail kept as gaps (xGaps), where tr and roc12 are null. Funds
// new to the snapshot are backfilled; funds that leave it keep their history and
// last row (listed: false), so the backtest gains the non-survivors from now on.
// A dev-server restart supersedes the old instance's worker (generation counter
// on globalThis); history saves merge with the file on disk. A source that fails
// is a null block plus a line in sourceErrors, never a 500.
// Files (repo root). CEFConnect's data is licensed and this repo is public, so all
// are gitignored (/cef-*) and none may ever be committed:
//   cef-snapshot.json   the latest snapshot and the last row of every fund seen
//   cef-history.json    per fund: weekly [date, price, NAV] and distributions;
//                       backfill timing
//   cef-daily.json      archive: [price, NAV] per fund per day from each snapshot,
//                       keyed by date (the NAV date gets its NAV), 3 years kept
// The history and the archive are never written over when they cannot be read
// (logged, and a line in sourceErrors). Every write is a temp file renamed in.
// Route: /api/cef, and /api/cef?fund=TICKER for one fund (404 for one never seen).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://www.cefconnect.com/api/v3'
const SNAP_URL = `${BASE}/DailyPricing`
const HIST_URL = t => `${BASE}/pricinghistory/${encodeURIComponent(t)}/5Y`
const DIST_URL = (t, from, to) => `${BASE}/distributionhistory/fund/${encodeURIComponent(t)}/${mdyOf(from)}/${mdyOf(to)}`
export const SOURCE = 'CEFConnect (Nuveen), fund data from Morningstar: daily pricing, weekly price/NAV history, distribution history'
const H = 3600e3, DAY = 864e5
const SNAP_TTL = 6 * H, RUN_EVERY = 6 * H, RETRY_FAILED = 30 * 60e3, SNAP_BACKOFF = 5 * 60e3
const WEEKLY_STALE = 14, DIST_STALE = 30, DIST_TOPUP_DAYS = 400 // days
const TOPUP = 40, SAVE_EVERY = 20, GAP = 400, IN_FLIGHT = 2, TIMEOUT = 60_000, TRIES = 3
const ARCHIVE_YEARS = 3, PANEL_MONTHS = 61, SPARK = 52
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/
const PER_YEAR = { Monthly: 12, Quarterly: 4, 'Semi-Annually': 2, Annually: 1 }
// the snapshot fields kept on disk (CEFConnect's names)
const FIELDS = ['Ticker', 'Name', 'SponsorName', 'CategoryId', 'CategoryName', 'Strategy', 'Price', 'PriceChange', 'NAV', 'NAVPublished', 'LastUpdated',
  'Discount', 'Discount52WkAvg', 'ZScore3M', 'ZScore6M', 'ZScore1Yr', 'DistributionRatePrice', 'DistributionRateNAV', 'CurrentDistribution',
  'DistributionFrequency', 'IsManagedDistribution', 'EarningsPerShare', 'UNIIPerShare', 'LeverageRatioPercentage', 'IsLeveraged', 'ExpenseRatio',
  'MarketCapUSDm', 'TotalAssetsUSDm', 'AvgDailyVolume', 'Term', 'InceptionDate', 'ReturnOnNAV', 'ReturnOnPrice', 'Yr3RetOnNav', 'Yr5RetOnNav', 'NavTicker']
const NOTES = [
  'Survivorship: the history covers funds listed when it was first fetched; funds merged or liquidated before then are missing, so backtest returns lean high. Funds that leave the list from now on are kept (listed: false).',
  'Discount = price ÷ NAV - 1 on the same day; a few funds publish NAV only monthly or quarterly (navStale).',
  'Distribution splits (income, return of capital, gains) are the funds\' Section 19(a) estimates, not final tax character.',
  'Coverage = net investment income per share for the last reported half-year ÷ six months of the current distribution; it can be up to a year old.',
  'Data: CEFConnect (Nuveen) and Morningstar; for personal research, not for redistribution.',
]

const fin = v => typeof v === 'number' && Number.isFinite(v)
const num = v => (v == null || v === '' || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const rd = (v, k) => (fin(v) ? Math.round(v * 10 ** k) / 10 ** k : null)
const pad = n => String(n).padStart(2, '0')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ts = v => (v ? Date.parse(v) || 0 : 0) // ISO string → ms, 0 when absent
const isoDay = ms => new Date(ms).toISOString().slice(0, 10)
const today = () => isoDay(Date.now())
const addDays = (d, n) => isoDay(Date.parse(`${d}T00:00:00Z`) + n * DAY)
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)
const addMonths = (ym, k) => { const t = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}` }
const mdyOf = d => `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`
const fromMdy = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim()); return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : null }
const dayOf = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null)
// the Friday of a date's week (weekly points are Fridays, or the day before a Friday holiday)
const weekOf = d => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, w === 0 ? -2 : 5 - w) }
const discOf = (p, n) => (p > 0 && n > 0 ? (p / n - 1) * 100 : null)
const quantile = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo) }
const medianOf = xs => quantile([...xs].sort((a, b) => a - b), 0.5)
const meanOf = xs => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
// share of values below x, ties counted half, 0-100
const rankIn = (vals, x) => { if (!fin(x) || !vals.length) return null; let lo = 0, eq = 0; for (const v of vals) { if (v < x) lo++; else if (v === x) eq++ } return Math.round((1000 * (lo + eq / 2)) / vals.length) / 10 }
// 'Equity' | 'Taxable bond' | 'Municipal' | 'Other' from CEFConnect's Strategy; hybrids and the physical-metal trusts are Other
export const familyOf = s => {
  const x = String(s || '')
  if (/^Fixed Income\s*-\s*Municipal/i.test(x)) return 'Municipal'
  if (/^Fixed Income/i.test(x)) return 'Taxable bond'
  if (/^Equity\s*-\s*Commodit/i.test(x)) return 'Other'
  if (/^Equity/i.test(x)) return 'Equity'
  return 'Other'
}
const shortCat = s => String(s || '').replace(/^Morningstar US CEF\s*/i, '').trim() || null
const NAV_STALE_DAYS = 7
const navStaleOf = r => { const pd = dayOf(r.LastUpdated), nd = dayOf(r.NAVPublished); return !!(pd && nd && daysBetween(nd, pd) > NAV_STALE_DAYS) }
// The price to set against a snapshot row's NAV. Same day: the close. NAV a day or few old: the archived close
// on the NAV date, else the one implied by CEFConnect's Discount, which for daily-NAV funds is that close
// (checked against the daily history: HQL, AEF, NFJ, ASA, BCV exact, THQ within 0.3%). NAV weeks old
// (navStale): today's price, since CEFConnect's Discount then moves with the price from one day to the next.
function priceForNav(r, dm) {
  const P = num(r.Price), N = num(r.NAV), D = num(r.Discount), pd = dayOf(r.LastUpdated), nd = dayOf(r.NAVPublished)
  if (!nd || nd === pd || navStaleOf(r)) return P
  if (dm?.[nd]?.[0] > 0) return dm[nd][0]
  return fin(D) && N > 0 ? rd(N * (1 + D / 100), 4) : P
}

function readStrict(file) {
  try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : { error: e.message } }
}
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); return true } catch (e) { console.warn(`CEF discounts: ${path.basename(file)} not written (${e.message})`); return false }
}
async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }))
}

// ── parsers ──────────────────────────────────────────────────────────────────
export function parseWeekly(j) {
  if (j && j.Data === null) return [] // CEFConnect's answer for a ticker it has no history for
  const h = j?.Data?.PriceHistory
  if (!Array.isArray(h)) throw new Error('no PriceHistory in the response')
  const out = h.map(x => [dayOf(x.DataDate), num(x.Data), num(x.NAVData)]).filter(r => r[0] && r[1] > 0 && r[2] > 0)
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return out.filter((r, i) => i === 0 || r[0] !== out[i - 1][0])
}
// [ex, pay, declared, total, income, returnOfCapital, longTermGain, shortTermGain, special]
export function parseDists(j) {
  if (!Array.isArray(j?.Data)) throw new Error('no Data array in the response')
  const out = j.Data.map(x => [fromMdy(x.ExDivDateDisplay), fromMdy(x.PayDateDisplay), fromMdy(x.DeclaredDateDisplay), num(x.TotDiv), num(x.Income), num(x.CapitalReturn), num(x.CapitalLT), num(x.CapitalST), num(x.Special)])
    .filter(r => r[0] && fin(r[3]))
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}
const mergeWeekly = (old, fresh) => {
  if (!fresh.length) return old || []
  const m = new Map((old || []).map(r => [r[0], r]))
  for (const r of fresh) m.set(r[0], r)
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}
// the fetched window replaces what was stored for it (19(a) estimates get revised)
const mergeDists = (old, fresh, from) => [...(old || []).filter(r => r[0] < from), ...fresh].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

// ── the module ───────────────────────────────────────────────────────────────
export function createCefDiscounts({ UA, dir, events = () => ({}) }) {
  const SNAP_FILE = path.join(dir, 'cef-snapshot.json')
  const HIST_FILE = path.join(dir, 'cef-history.json')
  const DAILY_FILE = path.join(dir, 'cef-daily.json')
  // one worker per process: a dev-server restart builds a new instance, and the old one's worker stops at its next fund
  const G = (globalThis.__cefDiscounts ||= { gen: 0, gate: { next: 0 } })
  const gen = ++G.gen
  const alive = () => G.gen === gen
  const gate = G.gate
  let ver = 0 // bumped whenever the data behind the payload changes

  // CEFConnect: browser UA, 60 s timeout, three tries; requests start GAP apart and a 429 holds all of them
  async function cefFetch(url, tries = TRIES) {
    for (let a = 1, held = 0; ;) {
      const wait = gate.next - Date.now()
      if (wait > 0) await sleep(wait)
      gate.next = Math.max(gate.next, Date.now()) + GAP
      let r
      try {
        r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.cefconnect.com/' }, signal: AbortSignal.timeout(TIMEOUT) })
        if (r.ok) { const text = await r.text(); try { return JSON.parse(text) } catch { throw new Error('not JSON') } }
      } catch (e) {
        if (a++ >= tries) throw new Error(e.name === 'TimeoutError' || e.name === 'AbortError' ? `timed out (${TIMEOUT / 1000} s)` : e.message)
        await sleep(1500 * a); continue
      }
      r.body?.cancel().catch(() => {})
      if (r.status === 429 && held++ < 5) {
        const ra = r.headers.get('retry-after'), secs = Number(ra) || (Date.parse(ra || '') - Date.now()) / 1000 || 30
        gate.next = Math.max(gate.next, Date.now() + 1000 * Math.min(120, Math.max(5, secs)))
        continue
      }
      if (r.status >= 500 && a++ < tries) { await sleep(2000 * a); continue }
      const err = new Error(`HTTP ${r.status}`); err.status = r.status; throw err
    }
  }

  // ── snapshot ──
  let snap = null, snapRunning = null, snapError = null, snapFailAt = 0
  function loadSnap() {
    if (snap) return snap
    const st = readStrict(SNAP_FILE)
    if (st.error) {
      // a cache, but it carries the last row of delisted funds: set the bad copy aside rather than lose it
      try { fs.renameSync(SNAP_FILE, `${SNAP_FILE}.corrupt-${Date.now()}`) } catch {}
      console.warn(`CEF discounts: cef-snapshot.json could not be read (${st.error}); set aside`)
      return null
    }
    if (st.data?.rows && Array.isArray(st.data.listed)) snap = st.data
    return snap
  }
  const snapAge = () => (snap?.fetched ? Date.now() - Date.parse(snap.fetched) : Infinity)
  async function fetchSnapshot() {
    const j = await cefFetch(SNAP_URL)
    if (!Array.isArray(j)) throw new Error('DailyPricing: not an array')
    const rows = j.filter(f => TICKER.test(String(f?.Ticker || '')) && num(f.Price) > 0)
    if (rows.length < 150) throw new Error(`DailyPricing: only ${rows.length} funds (expected about 360)`)
    const prev = loadSnap(), d = today()
    const all = { ...(prev?.rows || {}) }, seen = { ...(prev?.seen || {}) }
    for (const f of rows) {
      all[f.Ticker] = Object.fromEntries(FIELDS.map(k => [k, f[k] ?? null]))
      seen[f.Ticker] = { first: seen[f.Ticker]?.first || d, last: d }
    }
    const dates = rows.map(f => dayOf(f.LastUpdated)).filter(Boolean).sort()
    const next = { fetched: new Date().toISOString(), snapshotDate: dates[dates.length - 1] || d, listed: rows.map(f => f.Ticker).sort(), rows: all, seen }
    writeAtomic(SNAP_FILE, JSON.stringify(next))
    snap = next; ver++
    archiveSnapshot(rows)
    return next
  }
  function refreshSnapshot() {
    if (!snapRunning && Date.now() - snapFailAt > SNAP_BACKOFF) {
      snapRunning = fetchSnapshot()
        .then(s => { snapError = null; maintain(); return s })
        .catch(e => { snapError = e.message; snapFailAt = Date.now(); console.warn(`CEF discounts: snapshot failed: ${e.message}`); return null })
        .finally(() => { snapRunning = null })
    }
    return snapRunning
  }

  // ── the daily archive ──
  let daily = null, dailyBroken = null
  function loadDaily() {
    if (daily || dailyBroken) return daily
    const st = readStrict(DAILY_FILE)
    if (st.error || (st.data && typeof st.data.funds !== 'object')) { dailyBroken = st.error || 'no funds object'; console.warn(`CEF discounts: cef-daily.json could not be read (${dailyBroken}); not written until it is fixed`); return null }
    daily = st.data || { version: 1, funds: {} }
    return daily
  }
  // the NAV date gets [price that day, NAV]; the price date gets its close
  function archiveSnapshot(rows) {
    if (!loadDaily()) return
    const st = readStrict(DAILY_FILE) // re-read: never replace a file that has become unreadable
    if (st.error) { dailyBroken = st.error; daily = null; console.warn('CEF discounts: cef-daily.json could not be read; not written'); return }
    const a = st.data || { version: 1, funds: {} }, cutoff = addDays(today(), -Math.round(ARCHIVE_YEARS * 365.25))
    for (const f of rows) {
      const P = num(f.Price), N = num(f.NAV), pd = dayOf(f.LastUpdated), nd = dayOf(f.NAVPublished)
      const m = (a.funds[f.Ticker] ||= {})
      // a NAV weeks old gets no price: the close on its date is not known
      if (nd && N > 0) m[nd] = [navStaleOf(f) && nd !== pd ? m[nd]?.[0] ?? null : priceForNav(f, m), N]
      if (pd && P > 0 && pd !== nd) m[pd] = [P, m[pd]?.[1] ?? null]
      for (const k of Object.keys(m)) if (k < cutoff) delete m[k]
    }
    a.updated = new Date().toISOString()
    if (writeAtomic(DAILY_FILE, JSON.stringify(a))) { daily = a; ver++ }
  }

  // ── weekly history and distributions ──
  let hist = null, histBroken = null
  function loadHist() {
    if (hist || histBroken) return hist
    const st = readStrict(HIST_FILE)
    if (st.error || (st.data && typeof st.data.funds !== 'object')) { histBroken = st.error || 'no funds object'; console.warn(`CEF discounts: cef-history.json could not be read (${histBroken}); not written until it is fixed`); return null }
    hist = st.data || { version: 1, backfill: {}, funds: {} }
    hist.backfill ||= {}
    return hist
  }
  // merge the file on disk into memory (another instance may have saved since; the newer fetch of each
  // part wins), then write. In place: the worker holds references to the fund records.
  function saveHist() {
    if (!hist || histBroken) return false
    const st = readStrict(HIST_FILE)
    if (st.error) { histBroken = st.error; console.warn('CEF discounts: cef-history.json could not be read; not written'); return false }
    for (const [t, d] of Object.entries(st.data?.funds || {})) {
      const f = hist.funds[t]
      if (!f) { hist.funds[t] = d; continue }
      if (ts(d.wAt) > ts(f.wAt)) { f.w = d.w; f.wAt = d.wAt; f.wLast = d.wLast }
      if (ts(d.xAt) > ts(f.xAt)) { f.x = d.x; f.xAt = d.xAt; f.xGaps = d.xGaps }
      if (f.err && f.wAt && f.xAt && ts(f.wAt) > ts(f.err.at) && ts(f.xAt) > ts(f.err.at)) delete f.err
    }
    const db = st.data?.backfill || {}, mb = hist.backfill || {}
    hist.backfill = mb.finishedAt ? mb : db.finishedAt ? db : mb.startedAt && (!db.startedAt || mb.startedAt <= db.startedAt) ? mb : db
    hist.topUpAt = [hist.topUpAt, st.data?.topUpAt].filter(Boolean).sort().pop() || null
    hist.updated = new Date().toISOString()
    if (!writeAtomic(HIST_FILE, JSON.stringify(hist))) return false
    ver++
    return true
  }

  // ── the worker ──
  let run = null, runError = null, runFailAt = 0
  const marketCap = t => num(snap?.rows?.[t]?.MarketCapUSDm) || 0
  const missingOf = (h, s) => s.listed.filter(t => !h.funds[t]?.wAt || !h.funds[t]?.xAt)
  function maintain() {
    if (run || !alive() || Date.now() - runFailAt < SNAP_BACKOFF) return run
    const s = loadSnap(), h = loadHist()
    if (!s || !h) return null
    // funds still missing are retried 30 minutes after they failed; top-ups start once a first full pass is done
    const retry = missingOf(h, s).filter(t => Date.now() - ts(h.funds[t]?.err?.at) >= RETRY_FAILED)
    const topUp = !retry.length && !!h.backfill?.finishedAt && Date.now() - ts(h.topUpAt) >= RUN_EVERY
    if (!retry.length && !topUp) return null
    run = work(retry, topUp).catch(e => { runError = e.message; runFailAt = Date.now(); console.warn(`CEF discounts: worker: ${e.message}`) }).finally(() => { run = null })
    return run
  }
  async function work(backfill, topUp) {
    const h = hist, t0 = Date.now(), now = () => new Date().toISOString(), d = today()
    const from5y = addDays(d, -(5 * 365 + 45)), to = addDays(d, 90)
    let jobs
    if (backfill.length) {
      if (!h.backfill.startedAt) h.backfill = { startedAt: now(), funds: backfill.length }
      jobs = [...backfill].sort((a, b) => marketCap(b) - marketCap(a)).map(t => ({ t, w: !h.funds[t]?.wAt, x: !h.funds[t]?.xAt, from: from5y }))
    } else if (topUp) {
      h.topUpAt = now()
      const listed = snap.listed.map(t => [t, h.funds[t]]).filter(([, f]) => f)
      // a fund whose series was already stale when fetched (no history, or NAV published monthly) waits a week between tries
      const wait = f => (!f.wLast || daysBetween(f.wLast, f.wAt.slice(0, 10)) > WEEKLY_STALE ? 7 * DAY : DAY)
      const wDue = listed.filter(([, f]) => f.wAt && Date.now() - ts(f.wAt) > wait(f) && (!f.wLast || daysBetween(f.wLast, d) > WEEKLY_STALE))
        .sort((a, b) => (a[1].wLast || '').localeCompare(b[1].wLast || '')).slice(0, TOPUP).map(([t]) => t)
      const xDue = listed.filter(([, f]) => f.xAt && Date.now() - ts(f.xAt) > DIST_STALE * DAY)
        .sort((a, b) => a[1].xAt.localeCompare(b[1].xAt)).slice(0, TOPUP).map(([t]) => t)
      jobs = [...new Set([...wDue, ...xDue])].map(t => ({ t, w: wDue.includes(t), x: xDue.includes(t), from: addDays(d, -DIST_TOPUP_DAYS) }))
    }
    let since = 0, done = 0
    await pool(jobs, IN_FLIGHT, async job => {
      if (!alive()) return
      const f = (h.funds[job.t] ||= {}), errs = []
      if (job.w) {
        try {
          const pts = parseWeekly(await cefFetch(HIST_URL(job.t)))
          f.w = mergeWeekly(f.w, pts); f.wAt = now(); f.wLast = f.w.length ? f.w[f.w.length - 1][0] : null
        } catch (e) { errs.push(`history ${e.message}`) }
      }
      if (job.x && alive()) {
        const oldGaps = (f.xGaps || []).filter(g => g[1] < job.from)
        try { f.x = mergeDists(f.x, parseDists(await cefFetch(DIST_URL(job.t, job.from, to))), job.from); f.xAt = now(); f.xGaps = oldGaps } catch (e) {
          // for a few funds one bad record makes every range that includes it an HTML error page (BPRE: any
          // range reaching back into Sept-Nov 2025): fetch by quarter and note the quarters that fail as gaps
          try { const c = await distsByQuarter(job.t, job.from, to); f.x = mergeDists(f.x, c.rows, job.from); f.xAt = now(); f.xGaps = [...oldGaps, ...c.gaps] } catch { errs.push(`distributions ${e.message}`) }
        }
        if (!f.xGaps?.length) delete f.xGaps
      }
      if (errs.length) f.err = { at: now(), msg: errs.join('; '), n: (f.err?.n || 0) + 1 }
      else delete f.err
      ver++; done++
      if (++since >= SAVE_EVERY) { since = 0; saveHist() }
    })
    // the first full pass (resumed across restarts) is timed from its first start; funds that failed in it are retried later
    if (backfill.length && !h.backfill.finishedAt && alive()) {
      h.backfill.finishedAt = now()
      h.backfill.ms = ts(h.backfill.finishedAt) - ts(h.backfill.startedAt)
      h.backfill.failed = missingOf(h, snap).length
    }
    saveHist()
    runError = null
    console.log(`CEF discounts: ${backfill.length ? 'backfill' : 'top-up'} run: ${done} of ${jobs.length} funds in ${((Date.now() - t0) / 1000).toFixed(0)} s${alive() ? '' : ' (superseded)'}`)
  }

  // [from, to] in quarters (the range filters on the declared date); the quarters that fail come back as gaps
  async function distsByQuarter(t, from, to) {
    const rows = [], gaps = []
    for (let a = from; a <= to && alive(); a = addDays(a, 92)) {
      const b = addDays(a, 91) < to ? addDays(a, 91) : to
      try { rows.push(...parseDists(await cefFetch(DIST_URL(t, a, b), 2))) } catch { gaps.push([a, b]) }
    }
    if (!rows.length && gaps.length) throw new Error('every quarter failed')
    const seen = new Set()
    return { rows: rows.filter(r => { const k = `${r[0]}|${r[3]}|${r[1]}`; return seen.has(k) ? false : seen.add(k) }).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)), gaps }
  }

  // ── derived blocks ──
  // weekly points [{ d, p, n, x }] for a fund: the fetched series, then the archive's last day of each later week
  function seriesOf(t) {
    const w = hist?.funds?.[t]?.w || []
    const lastWeek = w.length ? weekOf(w[w.length - 1][0]) : ''
    const dm = daily?.funds?.[t] || {}, extra = new Map()
    for (const d of Object.keys(dm).sort()) { const [p, n] = dm[d]; if (p > 0 && n > 0 && weekOf(d) > lastWeek) extra.set(weekOf(d), [d, p, n]) }
    return [...w, ...extra.values()].map(([d, p, n]) => ({ d, p, n, x: discOf(p, n) }))
  }
  let memo = null
  function derive() {
    if (memo && memo.ver === ver) return memo
    const s = snap, h = hist, d = today()
    const tickers = [...new Set([...(s ? Object.keys(s.rows) : []), ...(h ? Object.keys(h.funds) : [])])].sort()
    const listedSet = new Set(s?.listed || [])
    const meta = t => { const r = s?.rows?.[t]; return { cat: r?.CategoryId ?? null, fam: familyOf(r?.Strategy) } }
    const ser = new Map(tickers.map(t => [t, seriesOf(t)]))
    const dists = t => h?.funds?.[t]?.x || []
    // distributions are known for (a, b] once fetched and outside any quarter that failed (declared then, ex up to ~60 days later)
    const distsKnown = (t, a, b) => !!h?.funds?.[t]?.xAt && !(h.funds[t].xGaps || []).some(g => g[0] <= b && addDays(g[1], 60) > a)

    // the screener rows (events are attached per response)
    const rows = !s ? null : tickers.filter(t => s.rows[t]).map(t => {
      const r = s.rows[t], P = num(r.Price), N = num(r.NAV), pd = dayOf(r.LastUpdated), nd = dayOf(r.NAVPublished)
      const disc = discOf(priceForNav(r, daily?.funds?.[t]), N), pts = ser.get(t) || []
      const five = pts.filter(p => p.d > addDays(d, -Math.round(5 * 365.25)) && fin(p.x)).map(p => p.x)
      // return of capital over the past 365 days of ex-dates; unknown when no distribution says how it splits
      const yr = dists(t).filter(x => x[0] > addDays(d, -365) && x[0] <= d)
      const tot = yr.reduce((a, x) => a + x[3], 0), roc = yr.reduce((a, x) => a + (x[5] || 0), 0), known = yr.some(x => [x[4], x[5], x[6], x[7]].some(fin))
      const per = PER_YEAR[r.DistributionFrequency], cd = num(r.CurrentDistribution), eps = num(r.EarningsPerShare)
      const adv = num(r.AvgDailyVolume)
      return {
        t, name: r.Name ?? null, sponsor: r.SponsorName ?? null, cat: shortCat(r.CategoryName), catId: r.CategoryId ?? null, strategy: r.Strategy ?? null, family: familyOf(r.Strategy),
        price: P, priceDate: pd, nav: N, navDate: nd, navStale: navStaleOf(r),
        disc: rd(disc, 2), discNow: rd(discOf(P, N), 2), disc52: rd(num(r.Discount52WkAvg), 2),
        z3m: num(r.ZScore3M), z6m: num(r.ZScore6M), z1y: num(r.ZScore1Yr), pct5y: five.length >= 26 ? rankIn(five, disc) : null,
        distPrice: rd(num(r.DistributionRatePrice), 2), distNav: rd(num(r.DistributionRateNAV), 2), distFreq: r.DistributionFrequency && r.DistributionFrequency !== 'None' ? r.DistributionFrequency : null,
        distAmt: cd, managed: r.IsManagedDistribution == null ? null : !!r.IsManagedDistribution,
        roc12: tot > 0 && known && distsKnown(t, addDays(d, -365), d) ? rd(roc / tot, 3) : null,
        coverage: fin(eps) && cd > 0 && per ? rd(eps / ((cd * per) / 2), 2) : null, eps,
        unii: num(r.UNIIPerShare), lev: num(r.LeverageRatioPercentage), expense: num(r.ExpenseRatio), mcap: num(r.MarketCapUSDm), assets: num(r.TotalAssetsUSDm),
        adv, advUsd: adv != null && P > 0 ? Math.round(adv * P) : null, term: r.Term == null ? null : !!r.Term, inception: dayOf(r.InceptionDate),
        ret1yNav: num(r.ReturnOnNAV), ret1yPrice: num(r.ReturnOnPrice), ret3yNav: num(r.Yr3RetOnNav), ret5yNav: num(r.Yr5RetOnNav),
        spark: pts.slice(-SPARK).map(p => rd(p.x, 2)), listed: listedSet.has(t), lastSeen: s.seen?.[t]?.last ?? null,
      }
    })

    // weekly cross-section of discounts, five years
    // (grouped by the week's Friday, labelled with the latest date seen in the week, so the week in progress is not dated ahead)
    const since = addDays(d, -Math.round(5 * 365.25)), byWeek = new Map()
    for (const pts of ser.values()) for (const p of pts) {
      if (p.d <= since || !fin(p.x)) continue
      const k = weekOf(p.d), b = byWeek.get(k) || byWeek.set(k, { d: p.d, v: [] }).get(k)
      b.v.push(p.x); if (p.d > b.d) b.d = p.d
    }
    const universe = [...byWeek.keys()].sort().map(k => { const { d: wd, v } = byWeek.get(k); v.sort((a, b) => a - b); return { d: wd, median: rd(quantile(v, 0.5), 2), p25: rd(quantile(v, 0.25), 2), p75: rd(quantile(v, 0.75), 2), n: v.length } })

    // the monthly panel
    let latest = ''
    for (const pts of ser.values()) if (pts.length && pts[pts.length - 1].d > latest) latest = pts[pts.length - 1].d
    let panel = null, seasonality = null
    if (latest) {
      const end = latest.slice(0, 7), months = Array.from({ length: PANEL_MONTHS }, (_, i) => addMonths(end, i - PANEL_MONTHS + 1))
      const lastPartial = end >= d.slice(0, 7)
      const M = months.length, funds = []
      for (const t of tickers) {
        const pts = ser.get(t)
        if (!pts?.length) continue
        const lastIn = new Map()
        pts.forEach((p, k) => lastIn.set(p.d.slice(0, 7), k))
        const ds = dists(t), out = { t, fam: meta(t).fam, disc: [], z: [], rel: [], tr: [], px: [] }
        let any = false
        for (let i = 0; i < M; i++) {
          const k = lastIn.get(months[i])
          if (k == null || !fin(pts[k].x)) { out.disc.push(null); out.z.push(null); out.tr.push(null); out.px.push(null); continue }
          const p = pts[k]; any = true
          out.disc.push(rd(p.x, 2)); out.px.push(rd(p.p, 2))
          // z against the 52 weeks to this point, as known then
          const from = addDays(p.d, -364), win = []
          for (let j = k; j >= 0 && pts[j].d > from; j--) if (fin(pts[j].x)) win.push(pts[j].x)
          let z = null
          if (win.length >= 26) { const m = meanOf(win), sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / (win.length - 1)); if (sd > 0) z = rd((p.x - m) / sd, 2) }
          out.z.push(z)
          // total return over the month: price plus distributions gone ex since last month-end
          const k0 = lastIn.get(addMonths(months[i], -1))
          let tr = null
          if (k0 != null) {
            const p0 = pts[k0], pr = p.p / p0.p, nr = p.n / p0.n
            const split = (pr >= 1.8 || pr <= 0.55) && (nr >= 1.8 || nr <= 0.55)
            // without the month's distributions a price-only figure would pass for a total return: null instead
            if (!split && distsKnown(t, p0.d, p.d)) { let dsum = 0; for (const x of ds) if (x[0] > p0.d && x[0] <= p.d) dsum += x[3]; tr = rd((p.p + dsum) / p0.p - 1, 5) }
          }
          out.tr.push(tr)
        }
        if (any) funds.push(out)
      }
      // rel: disc less the category median that month (3 funds needed), else the family median
      for (let i = 0; i < M; i++) {
        const byCat = new Map(), byFam = new Map()
        for (const f of funds) { const v = f.disc[i]; if (!fin(v)) continue; const { cat, fam } = meta(f.t); if (cat != null) (byCat.get(cat) || byCat.set(cat, []).get(cat)).push(v); (byFam.get(fam) || byFam.set(fam, []).get(fam)).push(v) }
        const catMed = new Map([...byCat].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, medianOf(v)]))
        const famMed = new Map([...byFam].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, medianOf(v)]))
        for (const f of funds) {
          const v = f.disc[i], { cat, fam } = meta(f.t), base = catMed.get(cat) ?? famMed.get(fam)
          f.rel.push(fin(v) && fin(base) ? rd(v - base, 2) : null)
        }
      }
      panel = { months, lastPartial, asOf: latest, funds }
      // seasonality: month-over-month change in month-end discount, by calendar month
      const buckets = Array.from({ length: 12 }, () => [])
      const lastFull = lastPartial ? M - 2 : M - 1
      for (const f of funds) for (let i = 1; i <= lastFull; i++) if (fin(f.disc[i]) && fin(f.disc[i - 1])) buckets[+months[i].slice(5, 7) - 1].push(f.disc[i] - f.disc[i - 1])
      seasonality = buckets.map((v, i) => ({ m: i + 1, mean: rd(meanOf(v), 2), median: rd(medianOf(v), 2), n: v.length }))
    }
    memo = { ver, rows, universe: universe.length ? universe : null, panel, seasonality }
    return memo
  }

  function backfillStatus() {
    const s = snap, h = hist
    if (!s || !h) return { done: 0, total: s?.listed?.length || 0, failed: 0, running: !!run }
    const missing = new Set(missingOf(h, s))
    return {
      done: s.listed.length - missing.size, total: s.listed.length, failed: [...missing].filter(t => h.funds[t]?.err).length, running: !!run,
      startedAt: h.backfill?.startedAt ?? null, finishedAt: h.backfill?.finishedAt ?? null, ms: h.backfill?.ms ?? null, topUpAt: h.topUpAt ?? null,
    }
  }

  function fundDetail(raw) {
    const t = String(raw || '').trim().toUpperCase()
    if (!TICKER.test(t)) { const e = new Error('fund must be a ticker (letters, digits and dots, up to 10)'); e.status = 400; throw e }
    loadSnap(); loadHist(); loadDaily()
    const r = snap?.rows?.[t], h = hist?.funds?.[t]
    if (!r && !h) { const e = new Error(`unknown fund ${t}`); e.status = 404; throw e }
    const dm = daily?.funds?.[t] || {}
    return {
      t, name: r?.Name ?? null, listed: !!snap?.listed?.includes(t),
      weekly: seriesOf(t).map(p => ({ d: p.d, price: p.p, nav: p.n, disc: rd(p.x, 2) })),
      daily: Object.keys(dm).sort().filter(d => dm[d][0] > 0 && dm[d][1] > 0).map(d => ({ d, price: dm[d][0], nav: dm[d][1], disc: rd(discOf(dm[d][0], dm[d][1]), 2) })),
      dists: (h?.x || []).map(x => ({ ex: x[0], pay: x[1], declared: x[2], total: x[3], income: x[4], roc: x[5], ltcg: x[6], stcg: x[7], special: x[8] })),
      historyFetched: h?.wAt ?? null, distsFetched: h?.xAt ?? null, source: SOURCE,
    }
  }

  async function get(req) {
    const q = new URL(req?.url || '/', 'http://x').searchParams
    if (q.has('fund')) return fundDetail(q.get('fund'))
    const sourceErrors = []
    loadSnap(); loadHist(); loadDaily()
    if (!snap) await refreshSnapshot()
    else if (snapAge() > SNAP_TTL) refreshSnapshot()
    maintain()
    if (snapError) sourceErrors.push({ source: 'CEFConnect daily pricing', error: snap ? `${snapError} (serving the snapshot of ${snap.fetched})` : snapError })
    if (histBroken) sourceErrors.push({ source: 'cef-history.json', error: `could not be read (${histBroken}); history is not updated until it is fixed` })
    if (dailyBroken) sourceErrors.push({ source: 'cef-daily.json', error: `could not be read (${dailyBroken}); the daily archive is not updated until it is fixed` })
    if (runError) sourceErrors.push({ source: 'CEFConnect history worker', error: runError })
    if (snap && hist) {
      const bad = missingOf(hist, snap).filter(t => hist.funds[t]?.err)
      if (bad.length) sourceErrors.push({ source: 'CEFConnect price/distribution history', error: `${bad.length} fund${bad.length > 1 ? 's' : ''} failed, retried after 30 minutes: ${bad.slice(0, 5).map(t => `${t} (${hist.funds[t].err.msg})`).join(', ')}${bad.length > 5 ? ' …' : ''}` })
    }
    const m = derive()
    let ev = {}
    try { ev = events() || {} } catch (e) { sourceErrors.push({ source: 'fund events', error: e.message }) }
    return {
      built: new Date().toISOString(), snapshotDate: snap?.snapshotDate ?? null, snapshotFetched: snap?.fetched ?? null,
      stale: snapAge() > SNAP_TTL, refreshing: !!snapRunning, sourceErrors,
      backfill: backfillStatus(),
      funds: m.rows ? m.rows.map(r => ({ ...r, events: ev[r.t] || [] })) : null,
      universe: m.universe, seasonality: m.seasonality, panel: m.panel,
      source: SOURCE, notes: NOTES,
    }
  }

  // synchronous: the latest snapshot's figures for one fund, for valuing tender offers at a % of NAV
  function lookup(ticker) {
    const s = loadSnap()
    if (!s || snapAge() > SNAP_TTL) refreshSnapshot()
    const t = String(ticker || '').trim().toUpperCase(), r = s?.rows?.[t]
    if (!r || !s.listed.includes(t)) return null
    loadDaily()
    const P = num(r.Price), N = num(r.NAV)
    return { price: P, nav: N, disc: rd(discOf(priceForNav(r, daily?.funds?.[t]), N), 2), navDate: dayOf(r.NAVPublished), name: r.Name ?? null }
  }

  return { get, lookup }
}
