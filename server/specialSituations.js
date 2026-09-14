// ============================================================================
// SPECIAL SITUATIONS — Greenblatt's "You Can Be a Stock Market Genius" and
// Suria's "The Event-Driven Edge", as a candidate pipeline
//   spinoffs   Form 10-12B registrations (the SpinCo registers itself) and the
//              parent's 8-K announcing a separation. Ratio, record and
//              distribution dates parsed from the information statement.
//   mergers    SC TO-T third-party tenders (target and bidder both named),
//              8-K Item 1.01 with an Agreement and Plan of Merger, DEFM14A
//              proxies as the vote stage, and FMP's M&A list to settle who is
//              acquiring whom. Cash terms parsed from the filing; spread and
//              annualised spread from the live quote. CVR / warrant / preferred
//              consideration is broken out as "merger securities" — the part
//              of merger arb Greenblatt actually recommends.
//   reorg      the bankruptcy feed's 8-K Item 1.03 petitions, then plan
//              effectiveness 8-Ks and 8-A12B new-equity registrations joined
//              by CIK — the post-reorganisation equity window.
//   rights     8-K rights offerings: subscription price, ratio, record and
//              expiry, oversubscription privilege, backstop.
//   recaps     SC TO-I issuer self-tenders (Dutch auctions and fixed-price,
//              interval-fund repurchases filtered out) and 8-K special
//              dividends — the leveraged-recap / stub setups.
//   insider    FMP open-market purchases (Form 4 code P), archived so clusters
//              build over 30 and 90 days.
//   activist   SCHEDULE 13D initial filings by fund-like filers.
// Every parsed term is flagged as parsed: the boards surface candidates, the
// Deal Book is where the reading happens. EDGAR full-text search is free and
// keyless; FMP is the dashboard's existing key. Documents are fetched once and
// their parsed terms kept in special-archive.json, so a rebuild costs the
// sweeps plus quotes. Cached 6h, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 6 * H, DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ymd = d => new Date(d).toISOString().slice(0, 10)
const today = () => ymd(Date.now())
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const median = xs => { const a = xs.filter(fin).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null }
const MON = '(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}'
const toIso = s => { const t = Date.parse(s); return Number.isFinite(t) ? ymd(t) : null }
const num = s => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : null }
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const wnum = s => (s == null ? null : WORDS[String(s).toLowerCase()] ?? num(s))
const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|l\.p|holdings?|group|trust|n\.v|s\.a|ag|se)\b\.?/gi
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim()
const firstWord = s => norm(s).split(' ')[0] || ''
const similar = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x === y || x.startsWith(y) || y.startsWith(x) || (firstWord(a).length > 3 && firstWord(a) === firstWord(b)) }
const cleanName = s => (s == null ? null : String(s).replace(/\s*,?\s+an?\s+[A-Z][a-z]+\s+(?:corporation|company|limited|partnership|limited liability company|public limited company)\b.*$/i, '').replace(/\s+,/g, ',').replace(/[\s,.;:]+$/, '').trim() || null)
const FUNDLIKE = /\b(L\.?P\.?|Partners?|Capital|Management|Advisors?|Advisers?|Fund|Investments?|Asset|Master|Opportunit\w+|Value|Ventures|Holdings|Group|Associates|Equity|Activist|LLC)\b/i
const INTERVAL = /\bfund\b|\btrust\b|\bbdc\b|\bportfolio\b|private credit|infrastructure|\bincome\b|\breit\b|\bcapital corp/i
const SPAC = /acquisition corp|acquisition co\b|acquisition company|\bSPAC\b|capital corp\b|blank check/i

// ── regex sets — every match is a candidate value, flagged parsed ────────────
const RX = {
  spin: {
    ratio: new RegExp(`(\\d+(?:\\.\\d+)?|one|two|three)\\s+shares?\\s+of\\s+[^.]{0,90}?for\\s+(?:each|every)\\s+(\\w+)\\s+shares?`, 'i'),
    record: new RegExp(`record date[^.]{0,80}?(${MON})`, 'i'),
    dist: new RegExp(`distribution date[^.]{0,80}?(${MON})`, 'i'),
    distAlt: new RegExp(`(?:distribut\\w+|completed|complete the separation)[^.]{0,60}?(?:on or about|on)\\s+(${MON})`, 'i'),
    whenIssued: /when-?issued/i,
    ticker: /(?:under the (?:ticker )?symbol|ticker symbol|trading symbol)\s+["“”']*([A-Z]{1,5})["“”']*/,
    parent: /wholly[- ]owned subsidiary of ([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| and | that | which )/,
    taxFree: /tax-free|section 355/i,
    spin: /(?:pro rata|tax-free)\s+(?:distribution|spin-?off)|spin-?off of|separat(?:e|ion) into two|two (?:independent|separate|standalone) (?:publicly[- ]traded |public )?compan|distribution of (?:all|the) (?:outstanding )?(?:shares|common stock) of/i,
    incentive: /(?:equity|long-term|stock) incentive plan|founder|stock options? (?:to|for) (?:our |the )?(?:executive|management|officers)/i,
  },
  merger: {
    cash: /\$\s?([\d.]+)\s+(?:per share\s+)?in cash/i,
    cash2: /(?:cash consideration|purchase price|offer price)\s+(?:of|equal to)\s+\$\s?([\d.]+)\s+per share/i,
    cash3: /\$\s?([\d.]+)\s+per share(?:,| in cash| net to the seller| without interest)/i,
    stock: /(\d\.\d{2,4})\s+(?:of a\s+)?shares?\s+of\s+(?:[A-Z][\w.&'’-]*\s+){1,6}(?:common stock|ordinary shares|class [AB])/i,
    cvr: /contingent value right/i,
    warrant: /warrants? (?:to purchase|exercisable)/i,
    preferred: /preferred (?:stock|shares) (?:as|of) (?:merger )?consideration|consideration[^.]{0,80}preferred/i,
    outside: new RegExp(`(?:outside date|end date|termination date|long-?stop date)[^.]{0,90}?(${MON})`, 'i'),
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    meeting: new RegExp(`special meeting[^.]{0,120}?(${MON})`, 'i'),
    hsr: /Hart-Scott-Rodino|\bHSR\b/i,
    cfius: /CFIUS|Committee on Foreign Investment/i,
    goShop: /go-shop/i,
    financing: /financing condition|debt financing|commitment letter/i,
    parentDef: /([A-Z][A-Za-z0-9&.,'’\- ]{2,80}?)\s*\(\s*(?:the\s+)?["“”']?Parent["“”']?\s*\)/,
    companyDef: /([A-Z][A-Za-z0-9&.,'’\- ]{2,80}?)\s*\(\s*(?:the\s+)?["“”']?Company["“”']?\s*\)/,
    acquiredBy: /(?:to be|will be|being|was) acquired by ([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| for | in | pursuant)/,
    willAcquire: /(?:will|to|agreed to) acquire (?:all of the outstanding shares of |all outstanding shares of )?([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| for | in | pursuant)/,
  },
  reorg: {
    effective: new RegExp(`(?:effective date of the plan|plan became effective|became effective|emerged from|emergence from)[^.]{0,160}?(${MON})`, 'i'),
    confirmed: new RegExp(`(?:confirm(?:ed|ing)|confirmation order)[^.]{0,120}?(${MON})`, 'i'),
    confirmAny: /confirm(?:ed|ing|ation)[^.]{0,60}plan/i,
    newShares: /([\d,]{6,})\s+shares? of (?:new )?(?:common stock|ordinary shares)/i,
    freshStart: /fresh[- ]start/i,
    ch11: /chapter 11|bankruptcy code|title 11|bankruptcy court/i,
    otc: /\bOTC\b|over-the-counter|pink/i,
    listing: /(?:listed|listing|trade) on (?:the )?(?:New York Stock Exchange|NYSE|Nasdaq)/i,
  },
  rights: {
    subPrice: /subscription price(?: of|,| equal to| will be)?[^.$]{0,60}\$\s?([\d.]+)/i,
    ratio: /(one|two|three|\d+(?:\.\d+)?)\s*(?:\(\d+\)\s*)?(?:non-?transferable\s+|transferable\s+)?(?:subscription\s+)?rights?\s+(?:for|per)\s+(?:each|every)?\s*(one|\d+(?:,\d{3})*|\w+)?\s*shares?/i,
    perRight: /(?:each|every)\s+(?:subscription\s+)?right\s+(?:will\s+)?entitle[^.]{0,80}?(?:purchase|subscribe for)\s+(one|\d+(?:\.\d+)?)\s+shares?/i,
    record: new RegExp(`record date[^.]{0,80}?(${MON})`, 'i'),
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    oversub: /over-?subscription (?:privilege|right)/i,
    backstop: /backstop|standby purchas/i,
    transferable: /\b(non-?transferable|transferable)\b/i,
    gross: /(?:gross proceeds|raise|aggregate)[^.]{0,60}?\$\s?([\d.]+)\s*(million|billion)/i,
  },
  toi: {
    upTo: /(?:purchase|repurchase|tender)[^.]{0,160}?up to\s+(\$?[\d,.]+\s*(?:million|billion)|[\d,]+\s+shares)/i,
    range: /not (?:less|lower) than \$\s?([\d.]+)[^.]{0,60}?(?:not (?:greater|more|higher) than|up to|and not more than|to) \$\s?([\d.]+)/i,
    fixed: /(?:purchase price of|at a price of|price of)\s+\$\s?([\d.]+)\s+per share/i,
    dutch: /(?:modified )?dutch auction/i,
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    oddLot: /odd lot/i,
    recap: /recapitalization|term loan|notes offering|senior notes|credit facility/i,
    optionExchange: /option exchange|eligible options|exchange (?:offer|program)[^.]{0,60}(?:stock options|option holders)|outstanding options? for/i,
    preferredOnly: /depositary shares?|preferred (?:stock|shares)[^.]{0,40}tender/i,
  },
  div: {
    amount: /special (?:cash )?dividend of \$\s?([\d.]+)\s+per share/i,
    amount2: /\$\s?([\d.]+)\s+per share special (?:cash )?dividend/i,
    payable: new RegExp(`(?:payable|paid) on[^.]{0,60}?(${MON})`, 'i'),
    record: new RegExp(`record[^.]{0,80}?(${MON})`, 'i'),
    recap: /recapitalization|term loan|notes offering|senior notes|credit facility|borrow/i,
  },
  d13: {
    pct: /percent of class represented[^0-9]{0,120}?([\d.]+)\s*%?/i,
    pctXml: /<percentOfClass>\s*([\d.]+)/i,
    purpose: /purpose of transaction\.?\s*(.{60,700}?)(?:item 5|interest in securities)/i,
    purposeXml: /<transactionPurpose>\s*([\s\S]{40,900}?)<\/transactionPurpose>/i,
    board: /board (?:seat|representation|of directors)|nominate|proxy (?:contest|fight)|director candidates/i,
    strategic: /strategic alternatives|sale of the (?:company|issuer)|maximize (?:shareholder|stockholder) value|undervalued/i,
  },
}

function parse(text, rx) {
  const out = {}
  for (const [k, re] of Object.entries(rx)) {
    const m = text.match(re)
    out[k] = m ? (m[2] !== undefined ? [m[1], m[2]] : m[1] !== undefined ? m[1] : true) : null
  }
  return out
}

const strip = html => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|&#x2019;/g, '’').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, ' ')

// "NAME  (TICK, TICK2)  (CIK 0000123)" → { name, tickers, ticker, cik }
function party(disp) {
  const m = String(disp || '').match(/^(.*?)\s*(?:\(([A-Z0-9.,\- ]+)\))?\s*\(CIK\s*(\d+)\)\s*$/)
  if (!m) return { name: String(disp || '').trim(), tickers: [], ticker: null, cik: null }
  const tickers = (m[2] || '').split(',').map(s => s.trim()).filter(Boolean)
  // the common: prefer a symbol with no share-class or preferred suffix
  const ticker = tickers.find(t => !/-/.test(t) && t.length <= 4) || tickers.find(t => !/-/.test(t)) || tickers[0] || null
  return { name: m[1].trim(), tickers, ticker, cik: +m[3] }
}

function row(h) {
  const s = h._source || {}
  const [adsh, fname] = String(h._id || '').split(':')
  const parties = (s.display_names || []).map(party)
  const p = parties[0] || { name: '?', tickers: [], ticker: null, cik: (s.ciks || [])[0] ? +(s.ciks || [])[0] : null }
  const cik = p.cik || ((s.ciks || [])[0] ? +(s.ciks || [])[0] : null)
  return {
    adsh, form: s.form, date: s.file_date, items: s.items || [], parties, name: p.name, ticker: p.ticker, cik,
    state: (s.biz_states || [])[0] || null, sic: (s.sics || [])[0] || null,
    doc: cik && adsh && fname ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${fname}` : null,
    index: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${adsh}-index.htm` : null,
  }
}

export function createSpecialSituations({ fetchYahooQuote, fetchYahooSparkline, FMP_KEY, UA, dir, bankruptcy }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const FILE = 'special-situations.json', ARCHIVE = 'special-archive.json', BOOK = 'special-dealbook.json'
  let mem = null, inflight = null
  // docs: parsed terms by "category:adsh" (permanent — a filing does not change);
  // insider: open-market purchases by key, pruned at 120 days
  const archive = load(ARCHIVE) || { docs: {}, insider: {} }
  archive.docs = archive.docs || {}; archive.insider = archive.insider || {}
  for (const k of Object.keys(archive.docs)) if (/^(13d|conf|eff):/.test(k)) delete archive.docs[k] // parsed under earlier rules

  const EH = { 'User-Agent': UA, Accept: 'application/json' }
  let edgarAt = 0
  // the full-text backend returns sporadic 500s even on queries that succeed a
  // second later, so a 5xx or 429 is retried twice with a growing pause
  async function edgar(url, asJson = true) {
    for (let attempt = 0; ; attempt++) {
      const wait = 320 - (Date.now() - edgarAt)
      if (wait > 0) await sleep(wait)
      edgarAt = Date.now()
      const r = await fetch(url, { headers: asJson ? EH : { 'User-Agent': UA } })
      if (r.ok) return asJson ? r.json() : r.text()
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue }
      throw new Error(`EDGAR HTTP ${r.status}`)
    }
  }

  // full-text search, paged; q must be non-empty on this endpoint so form-only
  // sweeps use a stop word
  async function fts({ q = 'a', forms, days = 180, pages = 1 }) {
    const end = today(), start = ymd(Date.now() - days * DAY)
    const out = []
    for (let p = 0; p < pages; p++) {
      let j
      try { j = await edgar(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}${forms ? `&forms=${encodeURIComponent(forms)}` : ''}&dateRange=custom&startdt=${start}&enddt=${end}&from=${p * 100}`) }
      catch (e) { if (p === 0) throw e; console.warn(`special fts page ${p} of ${forms || q}:`, e.message); break }
      const hits = j.hits?.hits || []
      out.push(...hits.map(row))
      if (hits.length < 100) break
    }
    return out
  }

  // fetch-and-parse once per filing per category. Budgeted per category per
  // build, newest first, so a cold start spends about a minute on documents and
  // the archive fills in over the following builds.
  const BUDGET = { spin: 14, spinann: 16, tot: 12, m8k: 16, defm: 6, conf2: 8, eff2: 10, rights: 16, toi: 10, div: 12, '13dx': 16 }
  let budget = {}
  async function terms(cat, r, rx, { xml = false } = {}) {
    const key = `${cat}:${r.adsh}`
    if (archive.docs[key]) return archive.docs[key]
    if (!r.doc || (budget[cat] ?? 0) <= 0) return null
    budget[cat]--
    try {
      const raw = await edgar(r.doc, false)
      if (raw.length > 4e6) { archive.docs[key] = { skipped: 'too large' }; return archive.docs[key] }
      const text = strip(raw)
      const t = parse(text, rx)
      if (xml) { const px = raw.match(RX.d13.pctXml); if (px) t.pct = px[1]; const pu = raw.match(RX.d13.purposeXml); if (pu) t.purpose = strip(pu[1]) }
      t.len = text.length
      archive.docs[key] = t
      return t
    } catch (e) { console.warn(`special doc ${cat} ${r.doc}: ${e.message}`); return null }
  }

  // ── quotes: one pass per build over every ticker any board needs ──────────
  const quotes = {}
  async function quote(t) {
    if (!t) return null
    if (quotes[t] !== undefined) return quotes[t]
    await sleep(120)
    quotes[t] = await fetchYahooQuote(t).catch(() => null)
    return quotes[t]
  }
  async function spark(t) { if (!t) return []; await sleep(120); return (await fetchYahooSparkline(t, '3mo', '1d').catch(() => [])).map(p => r2(p.v)).filter(fin) }

  async function fmp(pathq) {
    if (!FMP_KEY) return null
    const sep = pathq.includes('?') ? '&' : '?'
    const r = await fetch(`https://financialmodelingprep.com/stable/${pathq}${sep}apikey=${FMP_KEY}`)
    if (!r.ok) throw new Error(`FMP HTTP ${r.status}`)
    const j = await r.json()
    return Array.isArray(j) ? j : null
  }

  const dedupeBy = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, r) } return [...m.values()] }
  const newest = rows => [...rows].sort((a, b) => b.date.localeCompare(a.date))

  // ── spinoffs ──────────────────────────────────────────────────────────────
  async function spinoffs() {
    const f10 = newest(await fts({ forms: '10-12B,10-12B/A', days: 240, pages: 2 }))
    const ann = newest(await fts({ q: '"spin-off" "separation"', forms: '8-K', days: 180, pages: 2 }))
    const byCik = new Map()
    for (const r of f10) {
      const g = byCik.get(r.cik) || { spinco: r.name, ticker: r.ticker, cik: r.cik, filings: [], first: r.date, latest: r.date }
      if (!g.filings.some(f => f.adsh === r.adsh)) g.filings.push(r); g.first = r.date < g.first ? r.date : g.first; g.latest = r.date > g.latest ? r.date : g.latest
      if (r.ticker && !g.ticker) g.ticker = r.ticker
      byCik.set(r.cik, g)
    }
    const out = []
    for (const g of byCik.values()) {
      const latest = newest(g.filings)[0]
      const t = await terms('spin', latest, RX.spin)
      const afterFiling = d => (d && d >= ymd(Date.parse(g.first) - 30 * DAY) ? d : null)
      const dist = afterFiling(t ? toIso(t.dist || (Array.isArray(t.distAlt) ? t.distAlt[0] : t.distAlt)) : null)
      const record = afterFiling(t ? toIso(t.record) : null)
      const parent = cleanName(t?.parent)
      if (t && !t.spin && !(parent && !similar(parent, g.spinco))) continue // registered itself; not a separation
      const ratio = t?.ratio ? `${wnum(t.ratio[0])} for ${wnum(t.ratio[1]) ?? t.ratio[1]}` : null
      const distributed = dist && dist <= today()
      const stage = distributed ? 'distributed' : dist ? 'dated' : g.filings.length > 1 ? `Form 10 amended ×${g.filings.length - 1}` : 'Form 10 filed'
      const q = distributed && g.ticker ? await quote(g.ticker) : null
      const sp = distributed && g.ticker ? await spark(g.ticker) : []
      out.push({
        kind: 'form10', spinco: g.spinco, ticker: g.ticker, cik: g.cik, parent, parentTicker: null, stage, amendments: g.filings.length - 1,
        firstFiled: g.first, latestFiled: g.latest, record, dist, daysToDist: dist ? daysBetween(today(), dist) : null, ratio,
        whenIssued: !!t?.whenIssued, taxFree: !!t?.taxFree, incentive: !!t?.incentive, symbolInDoc: t?.ticker || null,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, spark: sp, sinceDist: sp.length > 2 && distributed ? r1((sp[sp.length - 1] / sp[0] - 1) * 100) : null,
        parsed: !!t, url: latest.index, state: latest.state,
      })
    }
    // parent announcements whose CIK has no Form 10 of its own
    const f10Ciks = new Set(byCik.keys())
    const corporate = r => !r.items.length || r.items.some(i => /^(1\.01|2\.01|7\.01|8\.01|3\.03|5\.03)/.test(i))
    for (const r of dedupeBy(ann.filter(r => !f10Ciks.has(r.cik) && r.ticker && corporate(r)), r => r.cik)) {
      const t = await terms('spinann', r, RX.spin)
      if (t && !t.spin) continue // read it, and it is not a separation of a business
      const dist = (d => (d && d >= ymd(Date.parse(r.date) - 30 * DAY) ? d : null))(t ? toIso(t.dist || (Array.isArray(t.distAlt) ? t.distAlt[0] : t.distAlt)) : null)
      const q = await quote(r.ticker)
      out.push({
        kind: 'parent8k', spinco: null, ticker: null, cik: r.cik, parent: r.name, parentTicker: r.ticker, stage: dist && dist <= today() ? 'distributed' : dist ? 'dated' : 'announced',
        amendments: 0, firstFiled: r.date, latestFiled: r.date, record: t ? toIso(t.record) : null, dist, daysToDist: dist ? daysBetween(today(), dist) : null,
        ratio: t?.ratio ? `${wnum(t.ratio[0])} for ${wnum(t.ratio[1]) ?? t.ratio[1]}` : null, whenIssued: !!t?.whenIssued, taxFree: !!t?.taxFree, incentive: !!t?.incentive, symbolInDoc: t?.ticker || null,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, spark: [], sinceDist: null, parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out.sort((a, b) => (b.latestFiled || '').localeCompare(a.latestFiled || ''))
  }

  // ── merger arb ────────────────────────────────────────────────────────────
  async function mergers() {
    const tot = newest(await fts({ forms: 'SC TO-T,SC TO-T/A', days: 180, pages: 2 })).filter(r => !SPAC.test(r.name))
    const k8 = newest(await fts({ q: '"Agreement and Plan of Merger"', forms: '8-K', days: 120, pages: 3 }))
      .filter(r => r.items.includes('1.01') && !r.items.includes('2.01') && !SPAC.test(r.name))
    const proxies = newest(await fts({ forms: 'DEFM14A', days: 180, pages: 1 })).filter(r => !SPAC.test(r.name))
    const cvrs = newest(await fts({ q: '"contingent value right"', forms: '8-K', days: 180, pages: 1 }))
    let fmpMa = []
    try { fmpMa = [...(await fmp('mergers-acquisitions-latest?page=0&limit=100') || []), ...(await fmp('mergers-acquisitions-latest?page=1&limit=100') || [])] } catch (e) { console.warn('special M&A:', e.message) }
    const byAcq = new Map(fmpMa.map(m => [+m.cik, m])), byTgt = new Map(fmpMa.map(m => [+m.targetedCik, m]))

    const deals = new Map() // key: target cik
    const upsert = (cik, patch) => { const d = deals.get(cik) || { targetCik: cik, filings: [], flags: {}, consideration: {} }; Object.assign(d, patch, { flags: { ...d.flags, ...(patch.flags || {}) }, consideration: { ...d.consideration, ...(patch.consideration || {}) } }); deals.set(cik, d); return d }

    // tenders: target first, bidder second
    for (const r of dedupeBy(tot, r => r.cik)) {
      const bidder = r.parties[1] || null
      const t = await terms('tot', r, RX.merger)
      const d = upsert(r.cik, { target: r.name, ticker: r.ticker, acquirer: bidder?.name || null, acquirerTicker: bidder?.ticker || null, stage: 'tender', announced: r.date, tenderExpiry: t ? toIso(t.expiry) : null, url: r.index, role: 'filing' })
      if (t) Object.assign(d.consideration, { cash: num(t.cash || t.cash2 || t.cash3), stock: t.stock ? num(t.stock) : null, cvr: !!t.cvr, warrant: !!t.warrant, preferred: !!t.preferred }), Object.assign(d.flags, { hsr: !!t.hsr, cfius: !!t.cfius, financing: !!t.financing })
      d.filings.push({ form: r.form, date: r.date, url: r.index })
    }
    // 8-K 1.01: settle the role with FMP first, then the defined terms in the text
    for (const r of dedupeBy(k8, r => r.cik)) {
      const t = await terms('m8k', r, RX.merger)
      let role = null, other = null, otherTicker = null
      if (byTgt.has(r.cik)) { role = 'target'; const m = byTgt.get(r.cik); other = m.companyName; otherTicker = m.symbol }
      else if (byAcq.has(r.cik)) { role = 'acquirer'; const m = byAcq.get(r.cik); other = m.targetedCompanyName; otherTicker = m.targetedSymbol || null }
      else if (t) {
        const parentDef = t.parentDef, companyDef = t.companyDef
        if (parentDef && similar(parentDef, r.name)) { role = 'acquirer'; other = companyDef || (t.willAcquire || null) }
        else if (companyDef && similar(companyDef, r.name)) { role = 'target'; other = parentDef || t.acquiredBy || null }
        else if (t.acquiredBy) { role = 'target'; other = t.acquiredBy }
        else if (t.willAcquire) { role = 'acquirer'; other = t.willAcquire }
        other = cleanName(other)
      }
      if (!role) continue // an 8-K we cannot place is not a candidate yet
      if (other && (norm(other).length < 4 || /^(?:the )?(?:company|parent|merger sub|company stock|buyer|seller|purchaser)$/i.test(norm(other)))) other = null
      if (role === 'acquirer' && !other) continue // an acquirer with no identifiable target is not a row
      const targetCik = role === 'target' ? r.cik : -r.cik // acquirer-side rows key on a negative cik until a target filing matches
      const existing = role === 'acquirer' ? [...deals.values()].find(d => d.target && other && similar(d.target, other)) : null
      const d = existing || upsert(targetCik, {})
      Object.assign(d, {
        target: d.target || (role === 'target' ? r.name : other), ticker: d.ticker || (role === 'target' ? r.ticker : otherTicker),
        acquirer: d.acquirer || (role === 'acquirer' ? r.name : other), acquirerTicker: d.acquirerTicker || (role === 'acquirer' ? r.ticker : otherTicker),
        stage: d.stage || 'announced', announced: d.announced && d.announced < r.date ? d.announced : r.date, url: d.url || r.index, role: d.role || (byTgt.has(r.cik) || byAcq.has(r.cik) ? 'FMP' : 'parsed'),
      })
      if (t) {
        if (!fin(d.consideration.cash)) d.consideration.cash = num(t.cash || t.cash2 || t.cash3)
        if (!fin(d.consideration.stock) && t.stock) d.consideration.stock = num(t.stock)
        d.consideration.cvr = d.consideration.cvr || !!t.cvr; d.consideration.warrant = d.consideration.warrant || !!t.warrant; d.consideration.preferred = d.consideration.preferred || !!t.preferred
        d.outsideDate = d.outsideDate || (t.outside ? toIso(t.outside) : null)
        Object.assign(d.flags, { hsr: d.flags.hsr || !!t.hsr, cfius: d.flags.cfius || !!t.cfius, goShop: d.flags.goShop || !!t.goShop, financing: d.flags.financing || !!t.financing })
      }
      d.filings.push({ form: r.form, date: r.date, url: r.index })
    }
    // proxies mark the vote stage
    for (const r of dedupeBy(proxies, r => r.cik)) {
      const d = deals.get(r.cik) || [...deals.values()].find(x => x.target && similar(x.target, r.name))
      const t = await terms('defm', r, RX.merger)
      if (d) { if (d.stage !== 'tender') d.stage = 'proxy'; d.meeting = t ? toIso(t.meeting) : null; d.filings.push({ form: r.form, date: r.date, url: r.index }); if (t) { if (!fin(d.consideration.cash)) d.consideration.cash = num(t.cash || t.cash2 || t.cash3); d.consideration.cvr = d.consideration.cvr || !!t.cvr; d.outsideDate = d.outsideDate || (t.outside ? toIso(t.outside) : null) } }
      else upsert(r.cik, { target: r.name, ticker: r.ticker, stage: 'proxy', announced: r.date, url: r.index, role: 'proxy', meeting: t ? toIso(t.meeting) : null, consideration: t ? { cash: num(t.cash || t.cash2 || t.cash3), cvr: !!t.cvr } : {} }).filings.push({ form: r.form, date: r.date, url: r.index })
    }
    for (const r of cvrs) { const d = deals.get(r.cik) || [...deals.values()].find(x => x.target && similar(x.target, r.name)); if (d) d.consideration.cvr = true }

    const out = []
    for (const d of deals.values()) {
      if (!d.target) continue
      const q = await quote(d.ticker)
      const aq = fin(d.consideration.stock) ? await quote(d.acquirerTicker) : null
      const price0 = q?.price ?? null
      const rawCash = d.consideration.cash
      const cash = fin(rawCash) && rawCash > 0 && (!fin(price0) || (rawCash >= 0.7 * price0 && rawCash <= 2 * price0)) ? rawCash : null
      const stockVal = fin(d.consideration.stock) && aq?.price ? d.consideration.stock * aq.price : null
      const value = fin(cash) || fin(stockVal) ? (cash || 0) + (stockVal || 0) : null
      const price = q?.price ?? null
      const gross = fin(value) && fin(price) && price > 0 ? (value / price - 1) * 100 : null
      const close = d.tenderExpiry || d.meeting || d.outsideDate || null
      const closeAssumed = !close
      const pastClose = !!close && close < today()
      const days = close ? Math.max(daysBetween(today(), close), 1) : Math.max(150 - daysBetween(d.announced, today()), 30)
      // past the last dated milestone the deal has closed, lapsed or gone quiet — the spread stays, the annualising stops
      const ann = fin(gross) && !pastClose ? gross * (365 / days) : null
      out.push({
        target: d.target, ticker: d.ticker, targetCik: d.targetCik > 0 ? d.targetCik : null, acquirer: d.acquirer, acquirerTicker: d.acquirerTicker, stage: pastClose ? `${d.stage} · past date` : d.stage, announced: d.announced, role: d.role, pastClose,
        cash: fin(cash) ? r2(cash) : null, stock: fin(d.consideration.stock) ? d.consideration.stock : null, acquirerPrice: aq?.price ?? null, value: fin(value) ? r2(value) : null,
        price, gross: r2(gross), annualized: r1(ann), daysToClose: days, closeDate: close, closeAssumed, outsideDate: d.outsideDate || null, meeting: d.meeting || null, tenderExpiry: d.tenderExpiry || null,
        securities: { cvr: !!d.consideration.cvr, warrant: !!d.consideration.warrant, preferred: !!d.consideration.preferred }, flags: d.flags,
        filings: d.filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), url: d.url,
      })
    }
    return out.sort((a, b) => (fin(b.gross) ? 1 : 0) - (fin(a.gross) ? 1 : 0) || (b.announced || '').localeCompare(a.announced || ''))
  }

  // ── restructurings ────────────────────────────────────────────────────────
  async function reorg() {
    let petitions = []
    try { const bk = await bankruptcy(); petitions = (bk?.public?.list || []).map(r => ({ ...r, cik: r.url ? +(r.url.match(/edgar\/data\/(\d+)/) || [])[1] || null : null })) } catch (e) { console.warn('special reorg: bankruptcy feed', e.message) }
    const petitionCiks = new Set(petitions.map(p => p.cik).filter(Boolean))
    // Item 1.03 is where plan confirmation and effectiveness get reported; an
    // 8-K without it and without a petition on file is an incentive-plan 8-K
    const bankrupt = r => r.items.includes('1.03') || petitionCiks.has(r.cik)
    const eff = newest(await fts({ q: '"effective date of the plan" "reorganization"', forms: '8-K', days: 240, pages: 2 })).filter(bankrupt)
    const conf = newest(await fts({ q: '"confirmation order" "plan of reorganization"', forms: '8-K', days: 240, pages: 2 })).filter(bankrupt)
    const listings = newest(await fts({ forms: '8-A12B,8-A12B/A', days: 240, pages: 2 }))
    const byCik = new Map()
    const get = (cik, name, ticker) => { const g = byCik.get(cik) || { cik, name, ticker: ticker || null, tickers: new Set(), petition: null, confirmed: null, emerged: null, listed: null, filings: [] }; if (ticker) g.tickers.add(ticker); byCik.set(cik, g); return g }
    for (const p of petitions) if (p.cik) { const g = get(p.cik, String(p.name).replace(/\s*\([A-Z0-9.,\- ]+\)\s*$/, '').trim(), p.ticker); g.petition = g.petition && g.petition < p.date ? g.petition : p.date; g.filings.push({ form: '8-K 1.03', date: p.date, url: p.url }) }
    for (const r of dedupeBy(conf, r => r.cik)) { const t = await terms('conf2', r, RX.reorg); if (t && !t.ch11) continue; const g = get(r.cik, r.name, r.ticker); g.confirmed = (t && toIso(t.confirmed)) || r.date; g.filings.push({ form: '8-K confirmed', date: r.date, url: r.index }) }
    for (const r of dedupeBy(eff, r => r.cik)) {
      const t = await terms('eff2', r, RX.reorg); if (t && !t.ch11) continue
      const g = get(r.cik, r.name, r.ticker)
      g.emerged = (t && toIso(t.effective)) || r.date; g.newShares = t?.newShares ? num(t.newShares) : null; g.freshStart = !!t?.freshStart; g.otc = !!t?.otc; g.exchange = !!t?.listing
      g.filings.push({ form: '8-K effective', date: r.date, url: r.index })
    }
    const known = new Set(byCik.keys())
    for (const r of listings) if (known.has(r.cik)) { const g = byCik.get(r.cik); g.listed = g.listed && g.listed < r.date ? g.listed : r.date; if (r.ticker) g.tickers.add(r.ticker); g.filings.push({ form: r.form, date: r.date, url: r.index }) }
    const out = []
    for (const g of byCik.values()) {
      if (!g.emerged && !g.confirmed && !g.listed) continue // plain petitions stay on the bankruptcy tab
      // post-emergence symbol: the one without the Q suffix if any
      const tickers = [...g.tickers]
      const ticker = tickers.find(t => !/Q$/.test(t)) || tickers[0] || null
      const stage = g.listed ? 'listed' : g.emerged ? (g.emerged <= today() ? 'emerged' : 'effective date set') : 'plan confirmed'
      const q = ticker ? await quote(ticker) : null
      const sp = ticker && stage !== 'plan confirmed' ? await spark(ticker) : []
      out.push({
        name: g.name, ticker, oldTickers: tickers.filter(t => /Q$/.test(t) && t !== ticker), cik: g.cik, stage, petition: g.petition, confirmed: g.confirmed, emerged: g.emerged, listed: g.listed,
        daysSince: g.emerged ? daysBetween(g.emerged, today()) : null, newShares: g.newShares || null, freshStart: !!g.freshStart, otc: !!g.otc, exchange: !!g.exchange,
        price: q?.price ?? null, spark: sp, since: sp.length > 2 ? r1((sp[sp.length - 1] / sp[0] - 1) * 100) : null,
        filings: g.filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), url: g.filings[0]?.url || null,
      })
    }
    return out.sort((a, b) => (b.emerged || b.confirmed || '').localeCompare(a.emerged || a.confirmed || ''))
  }

  // ── rights offerings ──────────────────────────────────────────────────────
  async function rights() {
    const hits = newest(await fts({ q: '"rights offering"', forms: '8-K', days: 150, pages: 2 })).filter(r => r.ticker && !SPAC.test(r.name))
    const out = []
    for (const r of dedupeBy(hits, r => r.cik)) {
      const t = await terms('rights', r, RX.rights)
      const sub = t ? num(t.subPrice) : null
      const record = t ? toIso(t.record) : null, expiry = t ? toIso(t.expiry) : null
      const q = await quote(r.ticker)
      const disc = fin(sub) && q?.price ? (1 - sub / q.price) * 100 : null
      const stage = expiry && expiry < today() ? 'closed' : record && record <= today() ? 'open' : daysBetween(r.date, today()) > 60 && !expiry ? 'likely closed' : 'announced'
      const rr = t?.ratio ? (Array.isArray(t.ratio) ? t.ratio : [t.ratio, null]) : null
      const ratio = rr ? `${wnum(rr[0]) ?? rr[0]} right${wnum(rr[0]) === 1 ? '' : 's'} per ${wnum(rr[1]) ?? rr[1] ?? 1} share` : null
      out.push({
        name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage, subPrice: sub, ratio, perRight: t?.perRight ? wnum(t.perRight) : null, record, expiry, daysToExpiry: expiry ? daysBetween(today(), expiry) : null,
        oversub: !!t?.oversub, backstop: !!t?.backstop, transferable: t?.transferable ? !/non/i.test(t.transferable) : null, gross: t?.gross ? `${t.gross[0]}${t.gross[1][0] === 'b' ? 'B' : 'M'}` : null,
        price: q?.price ?? null, discount: r1(disc), parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out
  }

  // ── recaps: self-tenders and special dividends ────────────────────────────
  async function recaps() {
    const toi = newest(await fts({ forms: 'SC TO-I,SC TO-I/A', days: 90, pages: 4 })).filter(r => r.ticker && !INTERVAL.test(r.name) && !SPAC.test(r.name))
    const divs = newest(await fts({ q: '"special dividend"', forms: '8-K', days: 150, pages: 2 })).filter(r => r.ticker)
    const out = []
    for (const r of dedupeBy(toi, r => r.cik)) {
      const t = await terms('toi', r, RX.toi)
      if (t && t.optionExchange) continue // an employee option repricing, not a buyback
      const range = t?.range ? [num(t.range[0]), num(t.range[1])] : null
      const fixed = t ? num(t.fixed) : null
      const expiry = t ? toIso(t.expiry) : null
      const q = await quote(r.ticker)
      const top = range ? range[1] : fixed
      const premium = fin(top) && q?.price ? (top / q.price - 1) * 100 : null
      out.push({
        kind: 'self-tender', name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage: expiry && expiry < today() ? 'closed' : 'open', amendments: toi.filter(x => x.cik === r.cik).length - 1,
        type: t?.dutch ? 'Dutch auction' : fixed ? 'fixed price' : 'tender', size: t?.upTo || null, low: range?.[0] ?? null, high: top ?? null, expiry, daysToExpiry: expiry ? daysBetween(today(), expiry) : null,
        oddLot: !!t?.oddLot, debtFunded: !!t?.recap, preferred: !!t?.preferredOnly, price: q?.price ?? null, premium: r1(premium), parsed: !!t, url: r.index, state: r.state,
      })
    }
    for (const r of dedupeBy(divs, r => r.cik)) {
      const t = await terms('div', r, RX.div)
      const amt = t ? num(t.amount || t.amount2) : null
      const q = await quote(r.ticker)
      out.push({
        kind: 'special dividend', name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage: t?.payable && toIso(t.payable) < today() ? 'paid' : 'declared', amendments: 0,
        type: 'special dividend', size: fin(amt) ? `$${amt}/sh` : null, low: null, high: fin(amt) ? amt : null, expiry: t?.payable ? toIso(t.payable) : null, daysToExpiry: null,
        oddLot: false, debtFunded: !!t?.recap, price: q?.price ?? null, premium: fin(amt) && q?.price ? r1((amt / q.price) * 100) : null, parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out.sort((a, b) => b.filed.localeCompare(a.filed))
  }

  // ── insider buying (FMP Form 4 purchases, archived) ───────────────────────
  async function insider() {
    let rows = []
    for (const p of [0, 1]) { try { rows.push(...(await fmp(`insider-trading/search?transactionType=P-Purchase&page=${p}&limit=1000`) || [])) } catch (e) { console.warn('special insider:', e.message); break } }
    for (const x of rows) {
      if (!(x.price > 0) || !(x.securitiesTransacted > 0) || !x.symbol) continue
      const key = `${x.symbol}|${x.reportingCik}|${x.transactionDate}|${x.securitiesTransacted}|${x.price}`
      archive.insider[key] = { s: x.symbol, d: x.transactionDate, f: x.filingDate, n: x.reportingName, c: x.reportingCik, t: x.typeOfOwner || '', sh: x.securitiesTransacted, p: x.price, own: x.securitiesOwned ?? null }
    }
    const cutoff = ymd(Date.now() - 120 * DAY)
    for (const k of Object.keys(archive.insider)) if ((archive.insider[k].d || '') < cutoff) delete archive.insider[k]
    const d30 = ymd(Date.now() - 30 * DAY), d90 = ymd(Date.now() - 90 * DAY)
    const bySym = new Map()
    for (const x of Object.values(archive.insider)) {
      if (x.d < d90) continue
      const g = bySym.get(x.s) || { symbol: x.s, buys30: 0, buyers30: new Set(), dollars30: 0, shares30: 0, buys90: 0, buyers90: new Set(), dollars90: 0, shares90: 0, ceoCfo: false, tenPctOnly: true, last: x.d, names: new Map() }
      const usd = x.sh * x.p
      const exec = /chief executive|chief financial|\bceo\b|\bcfo\b|president/i.test(x.t)
      if (exec) g.ceoCfo = true
      if (!/10 percent/i.test(x.t) || /director|officer/i.test(x.t)) g.tenPctOnly = false
      g.buys90++; g.buyers90.add(x.c); g.dollars90 += usd; g.shares90 += x.sh
      if (x.d >= d30) { g.buys30++; g.buyers30.add(x.c); g.dollars30 += usd; g.shares30 += x.sh }
      if (x.d > g.last) g.last = x.d
      const nm = g.names.get(x.c) || { name: x.n, title: x.t.replace(/,\s*$/, ''), usd: 0 }; nm.usd += usd; g.names.set(x.c, nm)
      bySym.set(x.s, g)
    }
    const list = [...bySym.values()].filter(g => g.dollars90 >= 25000).map(g => ({
      symbol: g.symbol, buys30: g.buys30, buyers30: g.buyers30.size, dollars30: Math.round(g.dollars30), avg30: g.shares30 ? r2(g.dollars30 / g.shares30) : null,
      buys90: g.buys90, buyers90: g.buyers90.size, dollars90: Math.round(g.dollars90), avg90: g.shares90 ? r2(g.dollars90 / g.shares90) : null,
      cluster: g.buyers30.size >= 3, ceoCfo: g.ceoCfo, tenPctOnly: g.tenPctOnly, last: g.last,
      top: [...g.names.values()].sort((a, b) => b.usd - a.usd).slice(0, 3).map(n => ({ name: n.name, title: n.title, usd: Math.round(n.usd) })),
    })).sort((a, b) => (b.cluster - a.cluster) || (b.dollars30 - a.dollars30) || (b.dollars90 - a.dollars90)).slice(0, 80)
    for (const g of list.slice(0, 40)) { const q = await quote(g.symbol); g.price = q?.price ?? null; g.since = fin(g.avg90) && q?.price ? r1((q.price / g.avg90 - 1) * 100) : null }
    return { list, archived: Object.keys(archive.insider).length, window: { d30, d90 } }
  }

  // ── activist 13Ds ─────────────────────────────────────────────────────────
  async function activist() {
    const hits = newest(await fts({ forms: 'SCHEDULE 13D', days: 60, pages: 3 }))
    const out = []
    for (const r of hits) {
      const subject = r.parties[0], filers = r.parties.slice(1)
      if (!subject?.ticker) continue
      const funds = filers.filter(f => FUNDLIKE.test(f.name) && !similar(f.name, subject.name))
      if (!funds.length) continue
      const filer = { name: funds.map(f => f.name).join(' / ') }
      if (out.some(o => o.adsh === r.adsh || (o.cik === subject.cik && o.filer === filer.name))) continue
      const t = await terms('13dx', r, RX.d13, { xml: true })
      const twin = out.find(o => o.cik === subject.cik && o.filed === r.date && fin(o.pct) && t?.pct && Math.abs(o.pct - num(t.pct)) < 0.05)
      if (twin) { twin.filer = [...new Set([...twin.filer.split(' / '), ...filer.name.split(' / ')])].join(' / '); continue }
      const q = await quote(subject.ticker)
      out.push({
        name: subject.name, ticker: subject.ticker, cik: subject.cik, adsh: r.adsh, filer: filer.name, filed: r.date, pct: t?.pct ? num(t.pct) : null,
        purpose: t?.purpose ? String(t.purpose).slice(0, 320) : null, board: !!t?.board, strategic: !!t?.strategic,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, parsed: !!t, url: r.index, state: r.state,
      })
      if (out.length >= 60) break
    }
    // FMP fills the stake size where the filing did not parse
    let filled = 0
    for (const o of out) {
      if (fin(o.pct) || filled >= 20) continue
      try { const rows = await fmp(`acquisition-of-beneficial-ownership?symbol=${encodeURIComponent(o.ticker)}&limit=5`); const m = (rows || []).find(x => o.filer.split(' / ').some(f => similar(x.nameOfReportingPerson, f))); if (m && num(m.percentOfClass) != null) { o.pct = num(m.percentOfClass); o.pctSource = 'FMP' } filled++ } catch {}
      await sleep(150)
    }
    return out
  }

  // ── build ─────────────────────────────────────────────────────────────────
  async function build() {
    const t0 = Date.now()
    budget = { ...BUDGET }
    for (const k of Object.keys(quotes)) delete quotes[k]
    const status = {}
    const run = async (name, fn, empty) => { try { const v = await fn(); status[name] = 'ok'; return v } catch (e) { status[name] = e.message; console.warn(`special ${name}:`, e.message); return empty } }
    const sp = await run('spinoffs', spinoffs, [])
    const mg = await run('mergers', mergers, [])
    const rg = await run('reorg', reorg, [])
    const rt = await run('rights', rights, [])
    const rc = await run('recaps', recaps, [])
    const ins = await run('insider', insider, { list: [], archived: 0 })
    const act = await run('activist', activist, [])
    save(ARCHIVE, archive)

    const wk = ymd(Date.now() - 7 * DAY)
    const live = mg.filter(m => fin(m.gross) && m.gross > -5 && m.gross < 60)
    const securities = mg.filter(m => m.securities.cvr || m.securities.warrant || m.securities.preferred)
    const pipeline = {
      spinoffs: { n: sp.length, pending: sp.filter(s => s.stage !== 'distributed').length, next30: sp.filter(s => fin(s.daysToDist) && s.daysToDist >= 0 && s.daysToDist <= 30).length, recent: sp.filter(s => s.stage === 'distributed' && s.dist >= ymd(Date.now() - 90 * DAY)).length },
      mergers: { n: mg.length, live: live.length, medianGross: r1(median(live.map(m => m.gross))), medianAnn: r1(median(live.map(m => m.annualized))), securities: securities.length, tenders: mg.filter(m => m.stage === 'tender').length },
      reorg: { n: rg.length, emerged90: rg.filter(r => r.emerged && r.emerged >= ymd(Date.now() - 90 * DAY) && r.emerged <= today()).length, confirmed: rg.filter(r => r.stage === 'plan confirmed').length },
      rights: { n: rt.length, open: rt.filter(r => r.stage === 'open').length, backstopped: rt.filter(r => r.backstop).length },
      recaps: { n: rc.length, tenders: rc.filter(r => r.kind === 'self-tender' && r.stage === 'open').length, dutch: rc.filter(r => r.type === 'Dutch auction').length, dividends: rc.filter(r => r.kind === 'special dividend').length },
      insider: { clusters: ins.list.filter(i => i.cluster).length, symbols: ins.list.length, ceoCfo: ins.list.filter(i => i.ceoCfo).length, archived: ins.archived },
      activist: { n: act.length, n30: act.filter(a => a.filed >= ymd(Date.now() - 30 * DAY)).length, board: act.filter(a => a.board).length },
    }
    const newThisWeek = [
      ...sp.filter(s => s.latestFiled >= wk).map(s => ({ cat: 'spinoff', name: s.spinco || s.parent, ticker: s.ticker || s.parentTicker, date: s.latestFiled, note: s.stage })),
      ...mg.filter(m => m.announced >= wk).map(m => ({ cat: 'merger', name: m.target, ticker: m.ticker, date: m.announced, note: m.acquirer ? `← ${m.acquirer}` : m.stage })),
      ...rg.filter(r => (r.emerged || r.confirmed || '') >= wk).map(r => ({ cat: 'reorg', name: r.name, ticker: r.ticker, date: r.emerged || r.confirmed, note: r.stage })),
      ...rt.filter(r => r.filed >= wk).map(r => ({ cat: 'rights', name: r.name, ticker: r.ticker, date: r.filed, note: fin(r.subPrice) ? `$${r.subPrice} sub` : r.stage })),
      ...rc.filter(r => r.filed >= wk).map(r => ({ cat: 'recap', name: r.name, ticker: r.ticker, date: r.filed, note: r.type })),
      ...act.filter(a => a.filed >= wk).map(a => ({ cat: '13D', name: a.name, ticker: a.ticker, date: a.filed, note: a.filer })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H, status,
      pipeline, newThisWeek, spinoffs: sp, mergers: mg, securities, reorg: rg, rights: rt, recaps: rc, insider: ins.list, insiderWindow: ins.window || null, activist: act,
      docsCached: Object.keys(archive.docs).length,
      source: 'SEC EDGAR full-text search (Form 10-12B, SC TO-T, SC TO-I, DEFM14A, SCHEDULE 13D, 8-A12B, and 8-K phrase sweeps), with deal terms parsed from the primary document of each filing; FMP mergers-acquisitions, insider-trading (Form 4 open-market purchases) and beneficial-ownership endpoints; Yahoo Finance quotes; the bankruptcy tracker’s 8-K Item 1.03 list. Every parsed field is a regex match on filing text and is labelled as such.',
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load(FILE); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; save(FILE, d); return d }
      catch (e) { console.warn('special situations build:', e.message); const disk = mem || load(FILE); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  // ── the Deal Book: the user's own pins, notes, dates and checklists ───────
  const dealBook = {
    list() { return load(BOOK) || { entries: [] } },
    save(obj) { const entries = Array.isArray(obj?.entries) ? obj.entries.slice(0, 500) : []; const out = { ts: Date.now(), entries }; save(BOOK, out); return out },
  }

  return { get, dealBook }
}
