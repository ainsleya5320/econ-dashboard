// ============================================================================
// ACCOUNTING FLAGS: the stock page's Accounting tab, the filings half. What a
// company has to file when something goes wrong, plus the footnote lines FMP
// does not carry, from free SEC sources (~7 requests a company, cached a day):
//   submissions   every filing with its 8-K item numbers and the minute EDGAR
//                 accepted it: restatements (Item 4.02), auditor changes
//                 (4.01), impairments (2.06), delisting notices (3.01), debt
//                 triggers (2.04), officer changes (5.02), late-filing notices
//                 (NT 10-K/Q), amended reports, SEC comment letters (UPLOAD)
//                 and replies (CORRESP), former names, and the 8-Ks accepted
//                 after 4 pm ET on a Friday or the eve of a federal holiday
//                 (Michelle Leder's Friday-night dump)
//   full text     material weaknesses, going-concern language, preferability
//                 letters (a voluntary accounting change the auditor has to
//                 call preferable: Exhibit 18), CFO appointments and exits
//   companyfacts  gross PP&E and depreciation (useful life), the bad-debt
//                 allowance, contract assets, capitalised software, the
//                 pension return assumption, cash and book taxes,
//                 restructuring and impairment charges
// The full-text queries match server/sinMonitorSeed.js, so a company's flags
// and the market-wide counts mean the same thing.
// Route: GET /api/accounting-flags?symbol=AAPL&cik=320193 (cik optional)
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const TTL = 24 * 3600e3, KEEP = 150, YEARS = 10
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pad = cik => String(cik).padStart(10, '0')
const fin = v => v != null && Number.isFinite(v)
const day = s => Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 864e5
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// 8-K items worth a line of their own: [type, label]
const ITEMS = {
  '4.02': ['restatement', 'Non-reliance on earlier financial statements (a restatement)'],
  '4.01': ['auditor', 'Change of auditor'],
  '2.06': ['impairment', 'Material impairment'],
  '3.01': ['delisting', 'Delisting notice or failed listing standard'],
  '2.04': ['trigger', 'Debt acceleration or default trigger'],
  '1.03': ['bankruptcy', 'Bankruptcy or receivership'],
}
// full-text searches: [type, query, forms, label]
const FULL_TEXT = [
  ['weakness', '"material weakness" "was not effective"', '10-K,10-Q', 'Material weakness; controls "not effective"'],
  ['goingConcern', '"substantial doubt" "going concern"', '10-K,10-Q', 'Going-concern language'],
  ['preferability', '"preferable in the circumstances"', '10-K,10-Q', 'Preferability letter: a voluntary accounting change'],
  ['cfo', '"as Chief Financial Officer"', '8-K', 'CFO appointment or departure'],
]
export const WEAKNESS_QUERY = FULL_TEXT[0][1]

// federal holidays (EDGAR's closures), observed dates, as YYYY-MM-DD
function holidays(y) {
  const iso = d => d.toISOString().slice(0, 10)
  const at = (m, d) => new Date(Date.UTC(y, m, d))
  const nth = (m, wd, n) => { const f = at(m, 1); return at(m, 1 + ((wd - f.getUTCDay() + 7) % 7) + 7 * (n - 1)) }
  const lastOf = (m, wd) => { const l = at(m + 1, 0); return at(m, l.getUTCDate() - ((l.getUTCDay() - wd + 7) % 7)) }
  const obs = d => { const w = d.getUTCDay(); return w === 6 ? at(d.getUTCMonth(), d.getUTCDate() - 1) : w === 0 ? at(d.getUTCMonth(), d.getUTCDate() + 1) : d }
  return [obs(at(0, 1)), nth(0, 1, 3), nth(1, 1, 3), lastOf(4, 1), ...(y >= 2021 ? [obs(at(5, 19))] : []), obs(at(6, 4)), nth(8, 1, 1), nth(9, 1, 2), obs(at(10, 11)), nth(10, 4, 4), obs(at(11, 25))].map(iso)
}
const HOL = new Map()
const isHoliday = s => { const y = +s.slice(0, 4); if (!HOL.has(y)) HOL.set(y, new Set(holidays(y))); return HOL.get(y).has(s) }
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
// EDGAR's acceptance stamp is UTC; the question is the hour in New York
function eastern(stamp) {
  const p = Object.fromEntries(ET.formatToParts(new Date(stamp)).map(x => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`, hour = +p.hour
  let next = new Date(Date.parse(`${date}T12:00:00Z`) + 864e5)
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = new Date(next.getTime() + 864e5)
  const eve = isHoliday(next.toISOString().slice(0, 10))
  return { date, time: `${p.weekday} ${p.hour}:${p.minute}`, late: hour >= 16 && (p.weekday === 'Fri' || eve), eve }
}

export function createAccountingFlags({ UA, dir }) {
  const FILE = path.join(dir, 'accounting-flags.json')
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { /* first run */ }
  const save = () => {
    const keep = Object.entries(cache).sort((a, b) => Date.parse(b[1].built) - Date.parse(a[1].built)).slice(0, KEEP)
    cache = Object.fromEntries(keep)
    try { fs.writeFileSync(FILE, JSON.stringify(cache)) } catch (e) { console.error('accounting-flags save:', e.message) }
  }
  const inflight = new Map()
  let next = 0
  // one slot every 150 ms (EDGAR allows ten a second); 5xx/429 retried; 404 = none
  async function sec(url) {
    for (let a = 0; ; a++) {
      const slot = Math.max(Date.now(), next); next = slot + 150
      if (slot > Date.now()) await sleep(slot - Date.now())
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) })
      if (r.ok) return r.json()
      if (r.status === 404) return null
      if ((r.status >= 500 || r.status === 429) && a < 3) { await sleep(1500 * (a + 1)); continue }
      throw new Error(`EDGAR HTTP ${r.status}`)
    }
  }
  let tickers = null, tickersAt = 0
  async function cikFor(symbol) {
    if (!tickers || Date.now() - tickersAt > 7 * 864e5) {
      const j = await sec('https://www.sec.gov/files/company_tickers.json')
      tickers = new Map(Object.values(j || {}).map(v => [String(v.ticker).toUpperCase(), v.cik_str])); tickersAt = Date.now()
    }
    return tickers.get(symbol) ?? tickers.get(symbol.replace('.', '-')) ?? null
  }

  async function fullText(cik, q, forms, since) {
    const out = []
    for (let p = 0; p < 3; p++) {
      const j = await sec(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=${encodeURIComponent(forms)}&ciks=${pad(cik)}&dateRange=custom&startdt=${since}&enddt=${new Date().toISOString().slice(0, 10)}&from=${p * 100}`)
      const hits = j?.hits?.hits || []
      out.push(...hits)
      if (hits.length < 100) break
    }
    // one row per filing; prefer the main document over an exhibit
    const by = new Map()
    for (const h of out) {
      const s = h._source || {}, [adsh, fname] = String(h._id || '').split(':')
      const main = s.file_type === s.form
      if (!by.has(adsh) || (main && !by.get(adsh).main)) by.set(adsh, { adsh, date: s.file_date, form: s.form, items: s.items || [], fileType: s.file_type, main, url: `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${fname}` })
    }
    return [...by.values()].sort((a, b) => b.date.localeCompare(a.date))
  }

  // companyfacts → one row per fiscal year end
  function factsRows(cf) {
    const g = cf?.facts?.['us-gaap'] || {}
    const series = (tag, unit = 'USD', annual = true) => {
      const m = new Map()
      for (const f of g[tag]?.units?.[unit] || []) {
        if (annual) { if (!f.start) continue; const len = day(f.end) - day(f.start); if (len < 340 || len > 390) continue }
        else if (f.start) continue
        const cur = m.get(f.end)
        if (!cur || f.filed > cur.filed) m.set(f.end, f)
      }
      return m
    }
    const first = (tags, unit, annual) => tags.map(t => series(t, unit, annual))
    const pick = (maps, end) => { for (const m of maps) { const f = m.get(end); if (f && fin(f.val)) return f.val } return null }
    const near = (maps, end) => { for (const m of maps) { if (m.has(end)) return m.get(end).val; for (const [e, f] of m) if (Math.abs(day(e) - day(end)) <= 10) return f.val } return null }
    const S = {
      rev: first(['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet']),
      cfo: first(['NetCashProvidedByUsedInOperatingActivities']),
      dep: first(['Depreciation']), dda: first(['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet']), amort: first(['AmortizationOfIntangibleAssets']),
      capSoftware: first(['CapitalizedComputerSoftwareAdditions', 'PaymentsToDevelopSoftware']),
      pensionRoa: first(['DefinedBenefitPlanAssumptionsUsedCalculatingNetPeriodicBenefitCostExpectedLongTermReturnOnAssets'], 'pure'),
      taxPaid: first(['IncomeTaxesPaidNet', 'IncomeTaxesPaid']), taxExp: first(['IncomeTaxExpenseBenefit']),
      restructuring: first(['RestructuringCharges', 'RestructuringSettlementAndImpairmentProvisions']),
      gwImpair: first(['GoodwillImpairmentLoss']), assetImpair: first(['AssetImpairmentCharges', 'ImpairmentOfLongLivedAssetsHeldForUse']),
      rnd: first(['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost']),
      ppeGross: first(['PropertyPlantAndEquipmentGross', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetBeforeAccumulatedDepreciationAndAmortization'], 'USD', false),
      allowance: first(['AccountsReceivableAllowanceForCreditLossCurrent', 'AllowanceForDoubtfulAccountsReceivableCurrent'], 'USD', false),
      arNet: first(['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'], 'USD', false),
      contractAssets: first(['ContractWithCustomerAssetNetCurrent', 'ContractWithCustomerAssetNet'], 'USD', false),
    }
    // fiscal year ends: the dates the annual cash flow and revenue lines end on
    const ends = [...new Set([...S.cfo[0].keys(), ...S.rev.flatMap(m => [...m.keys()])])].sort()
    const keep = []
    for (const e of ends) if (!keep.length || day(e) - day(keep[keep.length - 1]) > 300) keep.push(e)
    return keep.slice(-(YEARS + 1)).map(end => {
      const dep = pick(S.dep, end), dda = pick(S.dda, end), amort = pick(S.amort, end)
      const depUse = fin(dep) ? dep : fin(dda) && fin(amort) && dda > amort ? dda - amort : dda
      return {
        end, rev: Math.max(...S.rev.map(m => m.get(end)?.val).filter(fin), -Infinity), cfo: pick(S.cfo, end),
        dep: depUse, depKind: fin(dep) ? 'depreciation' : fin(dda) && fin(amort) && dda > amort ? 'D&A less amortization' : fin(dda) ? 'D&A' : null,
        ppeGross: near(S.ppeGross, end), allowance: near(S.allowance, end), arNet: near(S.arNet, end), contractAssets: near(S.contractAssets, end),
        capSoftware: pick(S.capSoftware, end), pensionRoa: pick(S.pensionRoa, end), taxPaid: pick(S.taxPaid, end), taxExp: pick(S.taxExp, end),
        restructuring: pick(S.restructuring, end), gwImpair: pick(S.gwImpair, end), assetImpair: pick(S.assetImpair, end), rnd: pick(S.rnd, end),
      }
    }).map(r => ({ ...r, rev: fin(r.rev) ? r.rev : null }))
  }

  async function build(cik, symbol) {
    const since = new Date(Date.now() - YEARS * 365.25 * 864e5).toISOString().slice(0, 10)
    const sub = await sec(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`)
    if (!sub) throw new Error(`EDGAR has no filer with CIK ${cik}`)
    const COLS = ['accessionNumber', 'filingDate', 'acceptanceDateTime', 'form', 'items', 'primaryDocument']
    const take = b => (b?.form || []).map((_, i) => Object.fromEntries(COLS.map(c => [c, b[c]?.[i] ?? null])))
    let filings = take(sub.filings?.recent)
    // older filings sit in extra pages; fetch the ones that reach into the window (at most three)
    for (const f of (sub.filings?.files || []).filter(f => f.filingTo >= since).slice(0, 3)) {
      filings = filings.concat(take(await sec(`https://data.sec.gov/submissions/${f.name}`)))
    }
    filings = filings.filter(f => f.filingDate >= since)
    const link = f => `https://www.sec.gov/Archives/edgar/data/${cik}/${f.accessionNumber.replace(/-/g, '')}/${f.primaryDocument || ''}`

    const events = []
    const eightKs = filings.filter(f => /^8-K/.test(f.form))
    for (const f of eightKs) {
      const items = String(f.items || '').split(',').map(s => s.trim()).filter(Boolean)
      for (const it of items) if (ITEMS[it]) events.push({ type: ITEMS[it][0], label: ITEMS[it][1], date: f.filingDate, form: f.form, items, url: link(f) })
    }
    for (const f of filings.filter(f => /^NT 10-[KQ]/.test(f.form))) events.push({ type: 'late', label: `Late-filing notice (${f.form})`, date: f.filingDate, form: f.form, url: link(f) })
    const officers = eightKs.filter(f => String(f.items || '').includes('5.02'))
    const amendments = filings.filter(f => /^10-[KQ]\/A$/.test(f.form)).map(f => ({ date: f.filingDate, form: f.form, url: link(f) }))
    const letters = filings.filter(f => f.form === 'UPLOAD' || f.form === 'SEC STAFF LETTER'), replies = filings.filter(f => f.form === 'CORRESP')
    const byYear = {}
    for (const f of letters) byYear[f.filingDate.slice(0, 4)] = (byYear[f.filingDate.slice(0, 4)] || 0) + 1
    const late = []
    for (const f of eightKs) {
      if (!f.acceptanceDateTime) continue
      const t = eastern(f.acceptanceDateTime)
      if (t.late) late.push({ adsh: f.accessionNumber, date: t.date, time: t.time, eve: t.eve, items: String(f.items || ''), url: link(f) })
    }

    const ft = {}
    for (const [type, q, forms, label] of FULL_TEXT) {
      const rows = await fullText(cik, q, forms, since).catch(e => { console.warn(`accounting-flags ${symbol} ${type}: ${e.message}`); return null })
      ft[type] = rows == null ? null : (type === 'cfo' ? rows.filter(r => r.items.includes('5.02')) : rows).map(r => ({ ...r, type, label }))
    }
    // a Friday-night 8-K that names a CFO change is the Footnoted case; mark it
    const cfoFilings = new Set((ft.cfo || []).map(r => r.adsh))
    for (const l of late) l.cfo = cfoFilings.has(l.adsh)
    let facts = []
    try { facts = factsRows(await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`)) } catch (e) { console.warn(`accounting-flags ${symbol} companyfacts: ${e.message}`) }

    return {
      cik: +cik, symbol, name: sub.name, sic: sub.sic ? +sub.sic : null, sicDesc: sub.sicDescription || '', fiscalYearEnd: sub.fiscalYearEnd || null,
      built: new Date().toISOString(), since,
      // EDGAR records a change of capitalisation ("APPLE INC." → "Apple Inc.") as a former name; skip those
      formerNames: (sub.formerNames || []).filter(n => norm(n.name) !== norm(sub.name)).map(n => ({ name: n.name, from: n.from?.slice(0, 10), to: n.to?.slice(0, 10) })),
      events: events.sort((a, b) => b.date.localeCompare(a.date)),
      fullText: ft,
      officers: { count: officers.length, latest: officers.slice(0, 6).map(f => ({ date: f.filingDate, url: link(f) })) },
      amendments,
      comments: { letters: letters.length, replies: replies.length, byYear, recent: letters.slice(0, 5).map(f => ({ date: f.filingDate, url: link(f) })) },
      fridays: { eightKs: eightKs.length, late },
      facts,
    }
  }

  async function get(req) {
    const u = new URL(req.url || '/', 'http://x')
    const symbol = String(u.searchParams.get('symbol') || '').toUpperCase()
    let cik = Number(u.searchParams.get('cik')) || null
    if (!cik && symbol) cik = await cikFor(symbol)
    if (!cik) throw new Error(`No SEC filer found for ${symbol || 'that request'}`)
    const hit = cache[cik]
    if (hit && Date.now() - Date.parse(hit.built) < TTL) return hit
    if (inflight.has(cik)) return inflight.get(cik)
    const p = (async () => {
      try { const d = await build(cik, symbol); cache[cik] = d; save(); return d }
      catch (e) { if (hit) return { ...hit, stale: e.message }; throw e }
      finally { inflight.delete(cik) }
    })()
    inflight.set(cik, p)
    return p
  }
  return { get }
}
