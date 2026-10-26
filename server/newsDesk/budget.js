// ============================================================================
// NEWS DESK BUDGET: the hard daily cap on Claude spending.
//
// Every Claude call the News Desk makes asks canSpend(estimate) first and
// calls record(model, usage) when the answer arrives. Spending is kept per
// day in news-usage.json at the repo root (gitignored), keyed by the
// server's LOCAL date, so the day resets at local midnight, not UTC.
//
//   createBudget({ dir, dailyUsd = 2 }) → {
//     remaining()            dollars left today (cap − spent − in-flight holds)
//     canSpend(estimateUsd)  true when the estimate fits under today's cap
//     hold(estimateUsd)      reserve the estimate for an in-flight call;
//                            returns release(), called once the call ends
//     record(model, usage)   price one response and add it to today;
//                            returns { usd, model }
//     today()                { day, spent, cap, calls, byModel, remaining,
//                              pending, paused? }
//   }
//
// Prices are dollars per million tokens from the Claude API reference
// (cached 2026-10-06). Cache writes bill at 1.25× input (5-minute entries)
// or 2× (1-hour entries); cache reads at 0.1× input. Thinking tokens are
// already inside output_tokens, which is the billed total. A response that a
// fallback model finished lists each attempt in usage.iterations with its
// own model; each attempt is priced at its own model's rates, and attempts
// declined before any output are counted too (the cap errs high, not low).
// A model missing from the table is priced at the top rate. Web searches add
// $10 per 1,000. The Ideas page's one-pagers keep a separate cap in their
// own file (file / label below).
//
// The file is re-read before each check and each record, so two processes
// (the dev server and a script) share one cap. The in-flight holds live in
// one object per process (globalThis), so the budgets of two desk instances
// in one process (Vite restarts the server in-process while the old one may
// still have a call in flight) see each other's holds. Writes go to a temp file and
// are renamed into place. A file that exists but cannot be parsed is set
// aside as news-usage.corrupt-<ts>.json and spending pauses for the rest of
// that day, because today's spend is no longer known.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

// $ per million tokens. longAt: prompts above this many input tokens bill at
// the long rates (Claude Haiku 5.5 only).
export const PRICES = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50, longAt: 100_000, longIn: 0.50, longOut: 2.50 },
  'claude-opus-5-5': { in: 4.00, out: 20.00, cacheRead: 0.20 },
  'claude-opus-5': { in: 5.00, out: 25.00 },
  'claude-opus-4-8': { in: 5.00, out: 25.00 },
}
const UNKNOWN = { in: 10.00, out: 50.00 }
const CACHE_WRITE_5M = 1.25
const CACHE_WRITE_1H = 2
const CACHE_READ = 0.1
const KEEP_DAYS = 120

const pad2 = n => String(n).padStart(2, '0')
export const localDay = (t = new Date()) => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
const num = v => (Number.isFinite(v) && v > 0 ? v : 0)
const round6 = v => Math.round(v * 1e6) / 1e6

// The price row for a model id: exact match, else the longest table key the
// id starts with (a dated snapshot of a listed model), else the top rate.
export function priceFor(model) {
  const id = String(model || '')
  if (PRICES[id]) return { ...PRICES[id], known: true }
  const key = Object.keys(PRICES).filter(k => id.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return key ? { ...PRICES[key], known: true } : { ...UNKNOWN, known: false }
}

// Dollars for one usage block (top-level usage or one iteration).
function costOfBlock(model, u) {
  const p = priceFor(model)
  const input = num(u.input_tokens)
  const read = num(u.cache_read_input_tokens)
  const cc = u.cache_creation
  const write1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0
  const write5m = cc ? num(cc.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens)
  const output = num(u.output_tokens)
  const long = p.longAt && input + read + write1h + write5m > p.longAt
  const pin = long ? p.longIn : p.in
  const pout = long ? p.longOut : p.out
  const pread = p.cacheRead != null && !long ? p.cacheRead : pin * CACHE_READ
  const usd = (input * pin + write5m * pin * CACHE_WRITE_5M + write1h * pin * CACHE_WRITE_1H + read * pread + output * pout) / 1e6
  return {
    usd, known: p.known,
    input, output, cacheRead: read, cacheWrite: write5m + write1h,
    thinking: num(u.output_tokens_details?.thinking_tokens),
  }
}

// Price one response's usage. Returns { usd, parts: [{ model, usd, ... }] }:
// one part per attempt when usage.iterations lists them, else one part.
// Web searches (the server-side search tool) bill $10 per 1,000 on top of
// tokens; they are credited to the attempt that answered (the last).
export const WEB_SEARCH_USD = 10 / 1000
export function costOf(model, usage) {
  if (!usage) return { usd: 0, parts: [] }
  const its = Array.isArray(usage.iterations) ? usage.iterations.filter(Boolean) : []
  const parts = its.length
    ? its.map(it => ({ model: it.model || model, ...costOfBlock(it.model || model, it) }))
    : [{ model, ...costOfBlock(model, usage) }]
  // Iterations carry no thinking breakdown; credit the top-level one to the
  // attempt that answered (the last). Observability only: output_tokens
  // already includes thinking.
  if (its.length && !parts.some(p => p.thinking)) parts[parts.length - 1].thinking = num(usage.output_tokens_details?.thinking_tokens)
  const searches = num(usage.server_tool_use?.web_search_requests)
  if (searches && parts.length) { const last = parts[parts.length - 1]; last.searches = searches; last.usd += searches * WEB_SEARCH_USD }
  return { usd: parts.reduce((s, p) => s + p.usd, 0), parts }
}

// A worst-case-leaning estimate before a call: every input token billed as a
// fresh 5-minute cache write, plus the expected output.
export function estimateUsd(model, { input = 0, output = 0 } = {}) {
  const p = priceFor(model)
  const long = p.longAt && input > p.longAt
  return (input * (long ? p.longIn : p.in) * CACHE_WRITE_5M + output * (long ? p.longOut : p.out)) / 1e6
}

// A short synchronous pause for retrying a file OneDrive has briefly locked.
const pause = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* not available */ } }
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES'])

// Dollars held for calls in flight, per usage file, shared by every budget in
// this process.
const HOLDS = globalThis.__newsDeskBudgetHolds || (globalThis.__newsDeskBudgetHolds = new Map())

// file / label / about let a second spender (the Ideas page's one-pagers) keep its own cap in its own file.
export function createBudget({ dir, dailyUsd = 2, file = 'news-usage.json', label = 'news-desk', about = 'News Desk Claude spending per local day (USD), written by server/newsDesk/budget.js. Gitignored.', log = console } = {}) {
  if (!dir) throw new Error('createBudget needs { dir }')
  const FILE = path.join(dir, file)
  const cap = Number(dailyUsd) > 0 ? Number(dailyUsd) : 2
  let state = { days: {} }
  let stamp = null // mtime + size of the copy in memory
  if (!HOLDS.has(FILE)) HOLDS.set(FILE, { pending: 0 })
  const held = HOLDS.get(FILE) // .pending: dollars held for calls in flight, in any instance

  const readFile = () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const st = fs.statSync(FILE)
        const sig = `${st.mtimeMs}:${st.size}`
        if (sig === stamp) return
        const raw = fs.readFileSync(FILE, 'utf8')
        let parsed
        try { parsed = JSON.parse(raw) } catch (e) { setAside(e.message, sig); return }
        if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') { setAside('it has no "days" table', sig); return }
        state = parsed
        stamp = sig
        return
      } catch (e) {
        if (e.code === 'ENOENT') { if (stamp !== 'none') { state = { days: {} }; stamp = 'none' } return }
        if (BUSY.has(e.code) && attempt < 4) { pause(60); continue }
        log.warn?.(`[${label}] budget: could not read ${file} (${e.code || e.message}); using the copy in memory`)
        return
      }
    }
  }

  // An unreadable file: move it aside, keep it for inspection, and pause
  // today's spending (what was already spent today is no longer known). If
  // it cannot be moved, it is left untouched and the pause lives in memory.
  const setAside = (why, sig) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const aside = path.join(dir, `${file.replace(/\.json$/, '')}.corrupt-${ts}.json`)
    let moved = true
    try { fs.renameSync(FILE, aside) } catch (e) { moved = false; log.error?.(`[${label}] budget: could not move the unreadable ${file} aside (${e.code || e.message})`) }
    log.error?.(`[${label}] budget: ${file} could not be read (${why})${moved ? `; moved to ${path.basename(aside)}` : ''}. Claude spending is paused until tomorrow.`)
    state = { days: { [localDay()]: { spent: 0, calls: 0, byModel: {}, paused: moved
      ? `${file} could not be read and was set aside as ${path.basename(aside)}; Claude spending is paused for the rest of today so the cap holds.`
      : `${file} could not be read; Claude spending is paused for the rest of today so the cap holds.` } } }
    if (moved) { stamp = null; writeFile() } else stamp = sig
  }

  const writeFile = () => {
    const keep = Object.keys(state.days).sort().slice(-KEEP_DAYS)
    const days = {}
    for (const d of keep) days[d] = state.days[d]
    state = { _about: about, cap, days }
    const tmp = `${FILE}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 1))
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, FILE); break } catch (e) {
          if (BUSY.has(e.code) && attempt < 4) { pause(60); continue }
          throw e
        }
      }
      const st = fs.statSync(FILE)
      stamp = `${st.mtimeMs}:${st.size}`
    } catch (e) {
      try { fs.unlinkSync(tmp) } catch { /* already gone */ }
      log.error?.(`[${label}] budget: could not save ${file} (${e.code || e.message}); this process keeps counting in memory`)
    }
  }

  const dayEntry = (d = localDay()) => state.days[d] || { spent: 0, calls: 0, byModel: {} }

  const today = () => {
    readFile()
    const day = localDay()
    const e = dayEntry(day)
    const spent = round6(num(e.spent))
    const out = {
      day, spent, cap,
      calls: e.calls || 0,
      byModel: e.byModel || {},
      pending: round6(held.pending),
      remaining: e.paused ? 0 : round6(Math.max(0, cap - spent - held.pending)),
    }
    if (e.paused) out.paused = e.paused
    return out
  }

  const remaining = () => today().remaining

  const canSpend = (estimateUsd = 0) => {
    const t = today()
    if (t.paused) return false
    return t.spent + t.pending + Math.max(0, Number(estimateUsd) || 0) <= cap + 1e-9
  }

  const hold = (estimateUsd = 0) => {
    const amt = Math.max(0, Number(estimateUsd) || 0)
    held.pending += amt
    let done = false
    return () => { if (!done) { done = true; held.pending = Math.max(0, held.pending - amt) } }
  }

  const record = (model, usage) => {
    const { usd, parts } = costOf(model, usage)
    readFile()
    const day = localDay()
    const e = dayEntry(day)
    e.spent = round6(num(e.spent) + usd)
    e.calls = (e.calls || 0) + 1
    e.byModel = e.byModel || {}
    for (const p of parts) {
      const m = e.byModel[p.model] || (e.byModel[p.model] = { calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 })
      m.calls += 1
      m.usd = round6(m.usd + p.usd)
      m.input += p.input; m.output += p.output; m.cacheRead += p.cacheRead; m.cacheWrite += p.cacheWrite; m.thinking += p.thinking
      if (p.searches) m.searches = (m.searches || 0) + p.searches
      if (!p.known) m.unpriced = 'not in the price table: billed here at the top rate'
    }
    state.days[day] = e
    writeFile()
    return { usd: round6(usd), model: parts.length ? parts[parts.length - 1].model : model }
  }

  readFile()
  return { remaining, canSpend, hold, record, today, cap }
}
