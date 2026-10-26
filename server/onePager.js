// ============================================================================
// ONE-PAGERS — Claude Opus 5.5 writes a one-page memo for an idea on the Ideas
// page: why the stock is cheap, what the market is focused on, and whether the
// market is wrong. Written for the shortlist's picks when the page shows them,
// and for any stock or special-situations card on request.
//
//   facts     the dashboard's own numbers, handed over up front: for a Magic
//             Formula pick its measures, ranks, flags and eight quarters as
//             filed (magicFormula.facts); for a special situation the scorer's
//             card (from ideas.get()); for both a year of daily prices (Yahoo)
//   research  the server-side web search and web fetch tools, which Opus 5.5
//             runs with dynamic filtering: the latest quarter and guidance, six
//             months of news, analysts' and short sellers' views, insiders,
//             debt and management changes
//   output    one strict submit_one_pager call with fixed sections. A source it
//             lists must be a URL its own searches or fetches returned; any
//             other is dropped.
//
// Model claude-opus-5-5, adaptive thinking at high effort, streamed, with the
// server-side refusal fallback (fallbacks: "default") on. Spending has its own
// daily cap (IDEAS_DAILY_BUDGET_USD, default $5) in ideas-usage.json, kept by
// the News Desk's budget module: each memo is held at $1 from the moment it is
// queued and usually costs $0.50 to $0.90 ($4 / $20 per million tokens, $0.01 a
// search).
// One runs at a time. Cache: ideas-onepagers.json at the root (gitignored), one
// memo per idea; a stock's goes stale when the company files a new quarter or
// after 30 days, a special situation's after 14. Refresh forces a rewrite.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { createBudget } from './newsDesk/budget.js'

const MODEL = 'claude-opus-5-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const HOLD_USD = 1 // a typical memo ran $0.66 (8 searches, 4 pages read); the record after each call keeps the cap honest
const DAY = 864e5, STALE_DAYS = { stock: 30, special: 14 }
const MAX_TURNS = 6 // pause_turn continuations and one nudge to submit
const VERDICTS = ['market looks wrong', 'market may be right', 'too close to call']
const KEY = /^(stock|special):[A-Z][A-Z0-9.\-]{0,9}$/

const SYSTEM = `You write one-page investment memos for an experienced investor who manages their own money. Each memo covers one idea the investor's dashboard flagged by rule: either Joel Greenblatt's Magic Formula (a high earnings yield and a high return on capital) or an event-driven special situation (a spinoff, tender, activist stake, insider buying, a post-bankruptcy stock and the like). The dashboard supplies its own numbers; you supply the current context and the judgment.

The memo answers three questions.
1. Why is it cheap? Put numbers on it: the valuation against the company's own history and its peers, how far the price has fallen and over what period, and what the price implies about the future.
2. What is the market focused on? The bear case as investors and analysts actually state it: specific worries with dates and sources, such as a guidance cut, a lost customer, litigation, leverage, a cyclical peak, an accounting question or a short report.
3. Is the market wrong, and why? The evidence that the worry is overdone, mispriced or already in the numbers. If the evidence says the market is right (a value trap, a business in structural decline, earnings at a cyclical peak, a one-off gain), say so plainly and set the verdict to match. A memo that talks the reader into a value trap is worse than none.

Research before writing. Use web search, and web fetch for a page worth reading in full: the latest quarterly results and guidance, news and controversies from the past six months, analysts' and short sellers' views, insider buying or selling, debt maturities and refinancing, management changes. Prefer company releases, SEC filings and established financial outlets, and note the date of each fact. Check the dashboard's numbers against what you find and say so when they disagree. Say so when coverage is thin.

Then call submit_one_pager once with the finished memo. Write plain sentences without markdown, one or two sentences per point, with numbers, units and dates. List only sources your searches or fetches returned.`

const SUBMIT = {
  name: 'submit_one_pager',
  description: 'Submit the finished one-pager. Call it once, after the research, with every section filled.',
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: VERDICTS, description: 'Your call on the question the memo answers: is the market mispricing this?' },
      headline: { type: 'string', description: 'One sentence: the case in brief.' },
      whyCheap: { type: 'array', items: { type: 'string' }, description: 'Two to four points: why it is cheap, with numbers.' },
      marketFocus: { type: 'array', items: { type: 'string' }, description: 'Two to four points: what the market is focused on, as investors and analysts state it, with dates.' },
      whyWrong: { type: 'array', items: { type: 'string' }, description: 'Two to four points: why the market may be wrong, or, where it is probably right, why.' },
      bearsRight: { type: 'array', items: { type: 'string' }, description: 'One to three points: what would prove the bears right.' },
      catalysts: {
        type: 'array', description: 'One to three dated events that could close the gap between price and value.',
        items: { type: 'object', properties: { when: { type: 'string', description: 'A date or period, such as "early February 2027 (fourth-quarter results)".' }, what: { type: 'string' } }, required: ['when', 'what'], additionalProperties: false },
      },
      watch: { type: 'array', items: { type: 'string' }, description: 'One to three signposts to monitor.' },
      sources: {
        type: 'array', description: 'Three to eight sources behind the memo, each a URL your web searches or fetches returned.',
        items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, or empty when unknown.' } }, required: ['title', 'url', 'date'], additionalProperties: false },
      },
      dataAsOf: { type: 'string', description: 'YYYY-MM-DD: the date of the newest information used.' },
    },
    required: ['verdict', 'headline', 'whyCheap', 'marketFocus', 'whyWrong', 'bearsRight', 'catalysts', 'watch', 'sources', 'dataAsOf'],
    additionalProperties: false,
  },
}
const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, max_content_tokens: 12000 },
  SUBMIT,
]

const fin = v => v != null && Number.isFinite(v)
const str = v => (typeof v === 'string' ? v.trim() : '')
const list = (v, max) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : [])
const oneLine = (s, n = 300) => String(s?.message || s || '').replace(/\s+/g, ' ').slice(0, n)
const money = v => {
  if (!fin(v)) return 'n/a'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : `${s}$${Math.round(a).toLocaleString()}`
}
const pct = (v, d = 1) => (fin(v) ? `${(v * 100).toFixed(d)}%` : 'n/a')
const today = () => new Date().toISOString().slice(0, 10)
// for matching a listed source against what the tools returned
const normUrl = u => String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').replace(/^http:/, 'https:').toLowerCase()

// every URL the server tools returned in a response (search results, fetched pages, text citations)
function toolUrls(content, into = new Set()) {
  const walk = (v, inTool) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) walk(x, inTool); return }
    const tool = inTool || (typeof v.type === 'string' && v.type.endsWith('_tool_result'))
    if (tool && typeof v.url === 'string') into.add(normUrl(v.url))
    if (Array.isArray(v.citations)) for (const c of v.citations) if (c?.url) into.add(normUrl(c.url))
    for (const k of Object.keys(v)) if (k !== 'encrypted_content' && k !== 'encrypted_index') walk(v[k], tool)
  }
  walk(content, false)
  return into
}

// After a mid-output fallback, blocks before the last fallback marker other than text don't echo back
function echoable(content = []) {
  const at = content.map(b => b?.type).lastIndexOf('fallback')
  return at < 0 ? content : [...content.slice(0, at).filter(b => b?.type === 'text'), ...content.slice(at + 1)]
}

export function createOnePagers({ ANTHROPIC_KEY, dir, dailyUsd = 5, magic, ideas, fetchYahooSparkline, client: testClient = null, log = console }) {
  const FILE = path.join(dir, 'ideas-onepagers.json')
  const budget = createBudget({ dir, dailyUsd, file: 'ideas-usage.json', label: 'ideas', about: 'Ideas one-pager Claude spending per local day (USD), written by server/newsDesk/budget.js for server/onePager.js. Gitignored.', log })
  const client = ANTHROPIC_KEY ? testClient || new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 600e3, maxRetries: 1 }) : null
  // jobs in flight, shared with any older instance a dev-server restart left running
  const G = (globalThis.__onePagers ||= { jobs: new Map(), errors: new Map(), chain: Promise.resolve() })

  let store = { version: 1, items: {} }, stamp = null
  const load = () => {
    try {
      const st = fs.statSync(FILE), sig = `${st.mtimeMs}:${st.size}`
      if (sig === stamp) return
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      if (j?.version === 1 && j.items) { store = j; stamp = sig }
    } catch (e) { if (e.code !== 'ENOENT') log.warn?.(`ideas-onepagers.json: ${e.message}`) }
  }
  const save = item => {
    load() // merge: another instance may have written since
    store.items[item.key] = item
    try {
      const tmp = `${FILE}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(store, null, 1)); fs.renameSync(tmp, FILE)
      const st = fs.statSync(FILE); stamp = `${st.mtimeMs}:${st.size}`
    } catch (e) { log.error?.(`ideas-onepagers.json save: ${e.message}`) }
  }

  // ── the context: what the dashboard already knows ────────────────────────
  async function prices(sym) {
    try {
      const s = (await fetchYahooSparkline(sym, '1y', '1d')).filter(p => fin(p.v))
      if (s.length < 20) return null
      const last = s[s.length - 1].v, hi = s.reduce((a, p) => (p.v > a.v ? p : a)), lo = s.reduce((a, p) => (p.v < a.v ? p : a))
      const day = p => new Date(p.ts > 1e12 ? p.ts : p.ts * 1000).toISOString().slice(0, 10)
      const back = n => (s.length > n ? s[s.length - 1 - n].v : null)
      return `Price history (Yahoo, daily, past year): last ${last.toFixed(2)}; ${pct(last / s[0].v - 1)} over the year, ${fin(back(63)) ? pct(last / back(63) - 1) : 'n/a'} over three months, ${fin(back(21)) ? pct(last / back(21) - 1) : 'n/a'} over one month; 52-week high ${hi.v.toFixed(2)} on ${day(hi)}, low ${lo.v.toFixed(2)} on ${day(lo)}; ${pct(last / hi.v - 1)} from the high.`
    } catch { return null }
  }

  async function context(kind, sym, ideaId) {
    if (kind === 'stock') {
      const f = magic.facts(sym)
      if (!f) return null
      const ranks = Object.entries(f.rank || {}).filter(([, r]) => r).map(([floor, r]) => `${r.rank} of ${r.n} at the ${floor === 'all' ? '$50M' : floor.replace('m', 'M').replace('b', 'B')} floor`).join('; ')
      const q = f.quarters.map(x => `  ${x.quarter} (ended ${x.ended}, filed ${x.filed || 'n/a'}): revenue ${money(x.revenue)}, operating income ${money(x.operatingIncome)}, net income ${money(x.netIncome)}`).join('\n')
      const lines = [
        `Idea: a Magic Formula buy (hold about a year): ${f.name} (${f.sym}), ${f.sector} / ${f.industry}, listed on ${f.exchange}.`,
        `Why the screen picked it: Greenblatt's combined rank of earnings yield and return on capital puts it ${ranks}.`,
        `Price ${fin(f.price) ? f.price.toFixed(2) : 'n/a'}; market value ${money(f.mcap)}; enterprise value ${money(f.ev)} (market value + debt + minority interest + preferred - cash and short-term investments).`,
        `Last four quarters: revenue ${money(f.revenue)}, operating income (EBIT) ${money(f.ebit)}. Earnings yield (EBIT / enterprise value) ${pct(f.ey)}; return on capital (EBIT / (net working capital + net PP&E${f.ppeProxy ? ', here all tangible long-term assets because PP&E is missing from the data' : ''})) ${pct(f.roc, 0)}; operating income ${fin(f.growth) ? `${f.growth >= 0 ? 'up' : 'down'} ${pct(Math.abs(f.growth), 0)} on the four quarters before` : 'growth n/a'}.`,
        `Cash and short-term investments ${money(f.cash)}; debt ${money(f.debt)}; balance sheet as of ${f.balanceSheetDate || 'n/a'}.`,
        f.flags?.length ? `Flags the screen raised: ${f.flags.map(x => x.text).join('; ')}.` : 'The screen raised no flags.',
        `Quarterly figures as filed (FMP):\n${q}`,
      ]
      const p = await prices(sym)
      if (p) lines.push(p)
      return { name: f.name, quarter: f.quarter?.label || null, text: lines.join('\n') }
    }
    const i = ((await ideas.get())?.special?.ideas || []).find(x => x.id === ideaId)
    if (!i || i.ticker !== sym) return null
    const lines = [
      `Idea: an event-driven special situation, ${i.kind}: ${i.call} for ${i.name} (${i.ticker}).${i.grade ? ` The dashboard's special-situations scorer grades it ${i.grade} (${i.score} points).` : ''}`,
      i.headline ? `The board's headline: ${i.headline}.` : null,
      `The scorer's case: ${i.why}`,
      `What would change it: ${i.change}`,
      `Horizon: ${i.horizon}.`,
      ...(i.links || []).filter(l => l.external).map(l => `${l.label}: ${l.href}`),
    ].filter(Boolean)
    const p = await prices(sym)
    if (p) lines.push(p)
    return { name: i.name, quarter: null, text: lines.join('\n') }
  }

  // ── one memo ─────────────────────────────────────────────────────────────
  function cleanMemo(x, urls) {
    if (!x || typeof x !== 'object' || !VERDICTS.includes(x.verdict) || !str(x.headline)) return null
    const memo = {
      verdict: x.verdict, headline: str(x.headline),
      whyCheap: list(x.whyCheap, 5), marketFocus: list(x.marketFocus, 5), whyWrong: list(x.whyWrong, 5), bearsRight: list(x.bearsRight, 4), watch: list(x.watch, 4),
      catalysts: (Array.isArray(x.catalysts) ? x.catalysts : []).map(c => ({ when: str(c?.when), what: str(c?.what) })).filter(c => c.what).slice(0, 4),
      dataAsOf: /^\d{4}-\d\d-\d\d$/.test(str(x.dataAsOf)) ? str(x.dataAsOf) : null,
    }
    if (!memo.whyCheap.length || !memo.marketFocus.length || !memo.whyWrong.length) return null
    const listed = (Array.isArray(x.sources) ? x.sources : []).map(s => ({ title: str(s?.title), url: str(s?.url), date: str(s?.date) })).filter(s => /^https?:\/\//i.test(s.url))
    // with no URLs found in the tool results (an unexpected response shape) the list is kept but marked unchecked
    const checked = urls.size > 0
    memo.sources = (checked ? listed.filter(s => urls.has(normUrl(s.url))) : listed).slice(0, 10)
    return { memo, sourcesChecked: checked, droppedSources: listed.length - memo.sources.length }
  }

  async function write(job) {
    const messages = [{ role: 'user', content: `Today is ${today()}. Write the one-pager for this idea. The dashboard's numbers:\n\n${job.ctx.text}` }]
    const urls = new Set()
    let usd = 0, searches = 0, fetches = 0, served = MODEL, nudged = false
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let msg
        try {
          msg = await client.beta.messages.stream({
            model: MODEL, max_tokens: 64000,
            thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
            system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
            tools: TOOLS, tool_choice: { type: 'auto' }, messages,
            betas: [FALLBACK_BETA], fallbacks: 'default',
          }).finalMessage()
        } catch (e) {
          // a stream cut off mid-answer may already have been billed: charge an estimate so the cap stays honest
          if (!e?.status) usd += budget.record(MODEL, { input_tokens: 30_000, output_tokens: 6_000 }).usd
          throw new Error(e?.status === 429 ? 'Claude is rate-limiting this key (429); try again in a minute.' : e?.status ? `Claude request failed (${e.status}): ${oneLine(e?.error?.error?.message || e?.message)}` : `Could not reach Claude: ${oneLine(e)}`)
        }
        served = msg.model || MODEL
        usd += budget.record(served, msg.usage).usd
        searches += msg.usage?.server_tool_use?.web_search_requests || 0
        fetches += msg.usage?.server_tool_use?.web_fetch_requests || 0
        toolUrls(msg.content, urls)
        if (msg.stop_reason === 'refusal') throw new Error(`Claude declined to write this one${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`)
        const call = msg.content.filter(b => b.type === 'tool_use' && b.name === 'submit_one_pager').pop()
        if (call) {
          if (msg.stop_reason === 'max_tokens') throw new Error('The memo ran past the output limit and was cut off.')
          const done = cleanMemo(call.input, urls)
          if (!done) throw new Error('Claude returned a memo with sections missing.')
          return { ...done, usd, searches, fetches, model: served }
        }
        if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: echoable(msg.content) }); continue }
        if (msg.stop_reason === 'max_tokens') throw new Error('The research ran past the output limit before the memo was written.')
        if (nudged) throw new Error('Claude finished without submitting the memo.')
        nudged = true
        messages.push({ role: 'assistant', content: echoable(msg.content) }, { role: 'user', content: 'Now call submit_one_pager with the finished memo.' })
      }
      throw new Error('The research did not finish within the turn limit.')
    } finally { job.release() }
  }

  function enqueue(job) {
    G.jobs.set(job.key, { status: 'queued', since: new Date().toISOString() })
    G.errors.delete(job.key)
    G.chain = G.chain.then(async () => {
      G.jobs.set(job.key, { status: 'running', since: new Date().toISOString() })
      const t0 = Date.now()
      try {
        const r = await write(job)
        save({
          key: job.key, kind: job.kind, symbol: job.sym, name: job.ctx.name, ideaId: job.ideaId || null, quarter: job.ctx.quarter,
          generatedAt: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), model: r.model, usd: Math.round(r.usd * 1e4) / 1e4,
          searches: r.searches, fetches: r.fetches, sourcesChecked: r.sourcesChecked, droppedSources: r.droppedSources, memo: r.memo,
        })
        log.info?.(`[ideas] one-pager ${job.key} on ${r.model}: $${r.usd.toFixed(3)}, ${r.searches} searches, ${Math.round((Date.now() - t0) / 1000)} s`)
      } catch (e) {
        G.errors.set(job.key, { at: new Date().toISOString(), message: oneLine(e) })
        log.warn?.(`[ideas] one-pager ${job.key}: ${oneLine(e)}`)
      } finally { G.jobs.delete(job.key) }
    })
  }

  const isStale = it => {
    if (!it) return true
    const days = STALE_DAYS[it.kind] || 30
    if (Date.now() - Date.parse(it.generatedAt) > days * DAY) return true
    if (it.kind === 'stock') { const f = magic.facts(it.symbol); if (f?.quarter?.label && it.quarter && f.quarter.label !== it.quarter) return true }
    return false
  }

  // ── what the routes see ──────────────────────────────────────────────────
  function summary(key) {
    load()
    const it = store.items[key], job = G.jobs.get(key), err = G.errors.get(key)
    const base = job ? { status: job.status, since: job.since } : err && (!it || err.at > it.generatedAt) ? { status: 'error', error: err.message } : it ? { status: isStale(it) ? 'stale' : 'ready' } : { status: 'none' }
    return it ? { ...base, generatedAt: it.generatedAt, verdict: it.memo?.verdict, headline: it.memo?.headline, usd: it.usd } : base
  }
  const budgetNow = () => { const t = budget.today(); return { day: t.day, spent: t.spent, cap: t.cap, remaining: t.remaining, paused: t.paused || null, perMemo: HOLD_USD } }

  function get(req) {
    const q = new URL(req?.url || '/', 'http://x').searchParams
    if (q.has('key')) {
      const key = q.get('key')
      if (!KEY.test(key)) return { error: 'bad key' }
      load()
      return { key, ...summary(key), item: store.items[key] || null, budget: budgetNow(), enabled: !!client }
    }
    const keys = (q.get('keys') || '').split(',').filter(k => KEY.test(k)).slice(0, 80)
    return { items: Object.fromEntries(keys.map(k => [k, summary(k)])), budget: budgetNow(), enabled: !!client }
  }

  async function request({ key, ideaId, force }) {
    if (!KEY.test(key || '')) return { status: 'error', error: 'bad key' }
    if (!client) return { status: 'error', error: 'No ANTHROPIC_API_KEY in .env, so one-pagers are off.' }
    const cur = summary(key)
    if (cur.status === 'queued' || cur.status === 'running') return cur
    if (cur.status === 'ready' && !force) return cur
    if (!budget.canSpend(HOLD_USD)) {
      const t = budget.today()
      return { ...cur, status: 'budget', error: t.paused || `Today's $${t.cap.toFixed(2)} one-pager budget is used up ($${t.spent.toFixed(2)} spent); more tomorrow, or raise IDEAS_DAILY_BUDGET_USD in .env.` }
    }
    const [kind, sym] = key.split(':')
    const ctx = await context(kind, sym, ideaId)
    if (!ctx) return { status: 'error', error: kind === 'stock' ? `${sym} is not in the current ranking.` : 'That special-situations idea is no longer on the board.' }
    if (G.jobs.has(key)) return summary(key) // asked twice while the context loaded
    // held from the queue on, so memos waiting their turn count against the cap too
    enqueue({ key, kind, sym, ideaId, ctx, release: budget.hold(HOLD_USD) })
    return summary(key)
  }

  return { get, request }
}
