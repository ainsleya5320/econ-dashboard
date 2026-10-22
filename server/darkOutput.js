// ============================================================================
// DARK OUTPUT — the fingerprints of AI output the national accounts can't see
// After SemiAnalysis, "AI Dark Output: The Visible Cost of Invisible Output"
// (May 2026). When AI does work a paid person used to do, the receipt
// disappears ("substitution" dark output: it reads as an output decline, and
// because service price indexes behave like wage indexes, prices may even
// rise); work nobody paid for before is "new" dark output; AI doing the work
// while the seller keeps the price is "captured" output (it shows up as
// margin). None of it can be measured directly, only through fingerprints:
//   (1) jobs in AI-exposed fields fall relative to the economy while their
//       AVERAGE pay rises (the cheapest junior workers leave the sample);
//   (2) heavy token use where measured output doesn't move (software
//       investment not breaking trend);
//   (3) boundary shift — purchased professional services moving in-house;
//   (4) sector misrouting.
// The tracker collects evidence either way. Whether the savings stay with
// firms (margins, profits share) or pass to customers (invisible deflation)
// is the question behind the S&P valuation, so both sides are scored.
//
// Sources (each verified with one request, Oct 2026):
//   BLS API v2  api.bls.gov/publicAPI/v2/timeseries/data/ (POST, BLS_KEY; one
//               request: 39 series × 20 years; keyless falls back to 25 series ×
//               10 years per request, 4 requests). CES national SA monthly
//               employment (…01, thousands) and average hourly earnings of all
//               employees (…03) — AHE exists for every industry used here, one
//               month behind employment; PRS85006093 productivity index,
//               PRS85006173 labor share, PRS85006113 unit labor costs (nonfarm
//               business, quarterly); PPI by industry (PCU…, NSA monthly) and
//               WPSFD4 final-demand services (SA). BLS has no PPI for computer
//               systems design (5415), accounting as a whole (5412: offices of
//               CPAs 541211 stands in), business support (5614) or office admin
//               (5611); advertising uses advertising agencies (54181).
//   Census QSS  www.census.gov/econ_getzippedfile/?programCode=QSS — the whole
//               Quarterly Services Survey as one 0.6 MB zip (keyless; the Census
//               API itself now redirects keyless calls to missing_key.html).
//               Total revenue (QREV), seasonally adjusted, $ millions a quarter,
//               2003Q4 on: 5411, 5412, 5415, 5416, 5418, 5613, 5112 (software
//               publishers), 518. No separate 5611 / 5614.
//   Indeed      raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/
//               US/job_postings_by_sector_US.csv (12 MB) and aggregate_job_
//               postings_US.csv — SA postings indexes, Feb 1 2020 = 100, 7-day
//               trailing average, daily; sent weekly (every 7th day back from
//               the latest).
//   NY Fed      newyorkfed.org/medialibrary/research/interactives/data/college-
//               labor-market/college-labor-{unemployment,underemployment}-data.csv
//               (the CSVs behind nyfed.org/collegelabor; quarterly release, CPS
//               via IPUMS, SA, 3-month moving average). Recent graduates = 22–27
//               with a BA+; young workers = 22–27 without one.
//   FRED        via the passed fred(id, limit) (vite.config.js's shared cache and
//               outage breaker): CPATAX (profits after tax with IVA & CCAdj),
//               GDP, B985RC1Q027SBEA (software investment), B985RX1Q020SBEA (real
//               software), COE, GDI. Any series FRED can't give falls back to
//               BEA's keyless NIPA flat file apps.bea.gov/national/Release/TXT/
//               NipaDataQ.txt (35 MB, same numbers: A551RC, A191RC, B985RC,
//               B985RX, A4002C, A261RC; $ millions → billions), at most weekly.
//   Local       sp500-people.json (server/peopleScreener.js): two fiscal years of
//               S&P 500 revenue, operating income and headcount per company —
//               a two-point matched-sample comparison, not a history.
//
// Rules: the reference year is 2022 (ChatGPT launched Nov 30, 2022): every
// index is 2022 average = 100 and every "change" is latest vs the 2022 average.
// Exposure is classified at the INDUSTRY level (see LABOR / QSS / POSTINGS
// roles); "exposed" pools are employment-weighted. Trends are log-linear OLS
// fits on 2015–2022 (services) or 2010–2022 (software), extended. Scorecard
// thresholds are in scorecard() and stated in each row's why.
// Cadence: daily (BLS/QSS/NY Fed move monthly or quarterly; Indeed daily); a
// refresh with any failed source retries after 2 hours. Stale-while-revalidate:
// an expired copy is served at once (stale: true) and refreshed behind it. A
// failed source keeps its last good raw block (cache, then the tracked seed),
// noted in sourceErrors; get() never throws once data exists. On load the
// payload is re-derived from the cached raw series, so a code change shows
// after a restart without refetching.
// Files: dark-output.json (root, gitignored cache: payload + raw series);
// data/seeds/dark-output.json (tracked seed: BLS, QSS, NY Fed and NIPA raw
// series — public statistics; Indeed is not seeded, it lives on GitHub).
// Requests per refresh: BLS 1, Census 1, Indeed 2, NY Fed 2, FRED 6 (cached),
// BEA 0–1.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const H = 3600e3, DAY = 24 * H, TTL = DAY, RETRY = 2 * H, BEA_EVERY = 7 * DAY
const BLS_API = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const QSS_ZIP = 'https://www.census.gov/econ_getzippedfile/?programCode=QSS'
const INDEED = 'https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/'
const NYFED = 'https://www.newyorkfed.org/medialibrary/research/interactives/data/college-labor-market/'
const BEA_FLAT = 'https://apps.bea.gov/national/Release/TXT/NipaDataQ.txt'
const BASE = '2022', OUT_M = '2015-01', OUT_Q = '2010-Q1', OUT_JR = '2000-01'

// --- what is tracked -------------------------------------------------------
// role: exposed (pooled in the composite) | control (pooled low-exposure
// comparison) | context (shown, pooled in neither)
const LABOR = [
  { id: 'legal', label: 'Legal services', naics: '5411', ces: '60541100', role: 'exposed' },
  { id: 'accounting', label: 'Accounting, tax prep & bookkeeping', naics: '5412', ces: '60541200', role: 'exposed' },
  { id: 'compsys', label: 'Computer systems design', naics: '5415', ces: '60541500', role: 'exposed' },
  { id: 'consulting', label: 'Management & technical consulting', naics: '5416', ces: '60541600', role: 'exposed' },
  { id: 'advertising', label: 'Advertising & PR', naics: '5418', ces: '60541800', role: 'exposed' },
  { id: 'software', label: 'Software publishers', naics: '5132', ces: '50513200', role: 'exposed' },
  { id: 'officeadmin', label: 'Office administrative services', naics: '5611', ces: '60561100', role: 'exposed' },
  { id: 'bizsupport', label: 'Business support incl. call centers', naics: '5614', ces: '60561400', role: 'exposed' },
  // the AI build-out lands here (cloud, hosting): its jobs can rise for reasons opposite to substitution
  { id: 'dataproc', label: 'Computing infrastructure & data processing', naics: '518', ces: '50518000', role: 'context' },
  // temp help: dominated by the cycle and by warehouse/industrial staffing
  { id: 'staffing', label: 'Employment services', naics: '5613', ces: '60561300', role: 'context' },
  { id: 'health', label: 'Health care', naics: '621-623', ces: '65620000', role: 'control' },
  { id: 'construction', label: 'Construction', naics: '23', ces: '20000000', role: 'control' },
  { id: 'leisure', label: 'Leisure & hospitality', naics: '71-72', ces: '70000000', role: 'control' },
]
const TOTAL = '05000000' // total private
// industry PPIs (BLS has none for 5415, 5611, 5614; proxies named in the label)
const PPI = {
  legal: { id: 'PCU5411--5411--', label: 'Legal services' },
  accounting: { id: 'PCU541211541211', label: 'Offices of CPAs (stands in for 5412)' },
  consulting: { id: 'PCU5416--5416--', label: 'Management & technical consulting' },
  advertising: { id: 'PCU54181-54181-', label: 'Advertising agencies (stands in for 5418)' },
  staffing: { id: 'PCU5613--5613--', label: 'Employment services' },
  software: { id: 'PCU5132--5132--', label: 'Software publishers' },
  dataproc: { id: 'PCU518210518210', label: 'Data processing & hosting' },
}
const PPI_SERVICES = 'WPSFD4', EXPOSED_PPI = ['legal', 'accounting', 'consulting', 'advertising']
const PRS = { productivity: 'PRS85006093', laborShare: 'PRS85006173', ulc: 'PRS85006113' }
// QSS revenue: 'purchased' = human-intensive professional work bought from outside (the composite);
// 'ai-vendor' = where spending on AI tools lands; matched on the category label, robust to code changes
const QSS = [
  { id: 'legal', label: 'Legal services', naics: '5411', re: /^5411:/, role: 'purchased' },
  { id: 'accounting', label: 'Accounting, tax prep & bookkeeping', naics: '5412', re: /^5412:/, role: 'purchased' },
  { id: 'compsys', label: 'Computer systems design', naics: '5415', re: /^5415:/, role: 'purchased' },
  { id: 'consulting', label: 'Management, scientific & technical consulting', naics: '5416', re: /^5416:/, role: 'purchased' },
  { id: 'advertising', label: 'Advertising & PR', naics: '5418', re: /^5418:/, role: 'purchased' },
  { id: 'staffing', label: 'Employment services', naics: '5613', re: /^5613:/, role: 'context' },
  { id: 'software', label: 'Software publishers', naics: '5132', re: /^51(?:12|32)\d*:\s*Software/i, role: 'ai-vendor' },
  { id: 'dataproc', label: 'Data processing & hosting', naics: '518', re: /^518:/, role: 'ai-vendor' },
]
const POSTINGS = [
  ['Software Development', true], ['Data & Analytics', true], ['IT Systems & Solutions', true], ['Legal', true],
  ['Accounting', true], ['Banking & Finance', true], ['Insurance', true], ['Marketing', true],
  ['Media & Communications', true], ['Customer Service', true], ['Administrative Assistance', true],
  ['Human Resources', true], ['Scientific Research & Development', true],
  ['Nursing', false], ['Construction', false], ['Food Preparation & Service', false], ['Loading & Stocking', false],
  ['Driving', false], ['Personal Care & Home Health', false],
]
const JUNIORS = [
  { id: 'recentGrads', label: 'Recent college graduates (22–27, BA+)', file: 'unemp', col: 'Recent graduates' },
  { id: 'youngWorkers', label: 'Young workers (22–27, no BA)', file: 'unemp', col: 'Young workers' },
  { id: 'collegeGrads', label: 'All college graduates (22–65)', file: 'unemp', col: 'College graduates' },
  { id: 'allWorkers', label: 'All workers (16–65)', file: 'unemp', col: 'All workers' },
  { id: 'recentGradsUnder', label: 'Recent graduates underemployed', file: 'under', col: 'Recent graduates' },
  { id: 'collegeGradsUnder', label: 'All college graduates underemployed', file: 'under', col: 'College graduates' },
]
const NIPA = {
  profits: { fred: 'CPATAX', bea: 'A551RC', label: 'Corporate profits after tax with IVA & CCAdj' },
  gdp: { fred: 'GDP', bea: 'A191RC', label: 'GDP' },
  software: { fred: 'B985RC1Q027SBEA', bea: 'B985RC', label: 'Private fixed investment in software' },
  softwareReal: { fred: 'B985RX1Q020SBEA', bea: 'B985RX', label: 'Real software investment (chained 2017 $)' },
  coe: { fred: 'COE', bea: 'A4002C', label: 'Compensation of employees, paid' },
  gdi: { fred: 'GDI', bea: 'A261RC', label: 'Gross domestic income' },
}

// --- small helpers -----------------------------------------------------------
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const qOrd = k => +k.slice(0, 4) * 4 + (+k.slice(6) - 1)
const mOrd = k => +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1)
const qKey = o => `${Math.floor(o / 4)}-Q${(o % 4) + 1}`
const mToQ = k => `${k.slice(0, 4)}-Q${Math.ceil(+k.slice(5, 7) / 3)}`
const nextKey = (f, k) => {
  if (f === 'M') { const o = mOrd(k) + 1; return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}` }
  if (f === 'Q') return qKey(qOrd(k) + 1)
  return new Date(Date.parse(`${k}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10)
}
// compact regular series for the cache and seed: { f, s: first key, v: [values, null for gaps] }
function enc(f, pts) {
  if (!pts.length) return { f, s: null, v: [] }
  const m = new Map(pts), last = pts.at(-1)[0], v = []
  for (let k = pts[0][0], n = 0; n < 5000; n++) { v.push(m.has(k) ? m.get(k) : null); if (k === last) break; k = nextKey(f, k) }
  return { f, s: pts[0][0], v }
}
function dec(e) { const out = []; if (!e?.s) return out; let k = e.s; for (const v of e.v) { if (v != null) out.push([k, v]); k = nextKey(e.f, k) } return out }
const from = (pts, k0) => pts.filter(p => p[0] >= k0)
const avgYear = (pts, y = BASE) => mean(pts.filter(p => p[0].startsWith(y)).map(p => p[1]))
const rebase = (pts, d = 2) => { const b = avgYear(pts); return fin(b) && b ? pts.map(([k, v]) => [k, rnd((v / b) * 100, d)]) : [] }
const roundPts = (pts, d) => pts.map(([k, v]) => [k, rnd(v, d)])
const ratio = (a, b) => { const m = new Map(b); return a.filter(p => fin(m.get(p[0])) && m.get(p[0])).map(([k, v]) => [k, v / m.get(k)]) }
const last = pts => (pts?.length ? pts.at(-1) : null)
function toQuarterly(pts) { // monthly → quarterly mean, full quarters only
  const g = new Map()
  for (const [k, v] of pts) { const q = mToQ(k); const a = g.get(q) || []; a.push(v); g.set(q, a) }
  return [...g].filter(([, a]) => a.length === 3).map(([q, a]) => [q, mean(a)]).sort((x, y) => x[0].localeCompare(y[0]))
}
// log-linear OLS trend over [k0, k1] (quarterly keys), extended from k0 to the latest point
function logTrend(pts, k0, k1) {
  const fit = pts.filter(p => p[0] >= k0 && p[0] <= k1 && p[1] > 0).map(([k, v]) => [qOrd(k), Math.log(v)])
  if (fit.length < 12) return null
  const mx = mean(fit.map(p => p[0])), my = mean(fit.map(p => p[1]))
  const b = fit.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / fit.reduce((s, [x]) => s + (x - mx) ** 2, 0), a = my - b * mx
  const end = last(pts)?.[0]; if (!end) return null
  const out = []; for (let o = qOrd(k0); o <= qOrd(end); o++) out.push([qKey(o), Math.exp(a + b * o)])
  return { pts: out, annual: (Math.exp(4 * b) - 1) * 100 }
}
const gapToTrend = (pts, tr) => { const l = last(pts); const t = tr?.pts.find(p => p[0] === l?.[0]); return l && t ? rnd(pct(l[1], t[1]), 1) : null }
// annualized growth between two points of a series ([key, v]; monthly or quarterly keys)
function annualized(a, b) {
  if (!a || !b || !(a[1] > 0) || !(b[1] > 0)) return null
  const yrs = a[0].includes('Q') ? (qOrd(b[0]) - qOrd(a[0])) / 4 : (mOrd(b[0]) - mOrd(a[0])) / 12
  return yrs > 0 ? ((b[1] / a[1]) ** (1 / yrs) - 1) * 100 : null
}
function csvLine(l) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}
// minimal zip reader (central directory → inflateRaw); Node has no unzip
function unzip(buf, want) {
  let eo = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break }
  if (eo < 0) throw new Error('not a zip file')
  let p = buf.readUInt32LE(eo + 16)
  for (let n = buf.readUInt16LE(eo + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    if (want.test(name)) {
      const d = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), body = buf.subarray(d, d + size)
      return method === 8 ? zlib.inflateRawSync(body) : body
    }
    p += 46 + nl + el + cl
  }
  throw new Error(`zip has no ${want}`)
}

export function createDarkOutput({ UA, dir, blsKey = '', fred }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch (e) { console.warn(`${n}: ${e.message}`) } return null }
  const save = (n, o) => { try { fs.mkdirSync(path.dirname(file(n)), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const CACHE = 'dark-output.json', SEED = path.join('data', 'seeds', 'dark-output.json')
  const scrub = s => (blsKey ? String(s).split(blsKey).join('***') : String(s))
  let mem = null, raw = null, nextAt = 0, inflight = null

  async function http(url, { timeout = 30_000, ...opt } = {}) {
    for (let a = 0; ; a++) {
      const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(timeout) })
      if (r.ok) return r
      if (r.status >= 500 && a < 2) { await new Promise(res => setTimeout(res, 1500 * (a + 1))); continue }
      throw new Error(`HTTP ${r.status}`)
    }
  }

  // --- fetchers: each returns a raw block (compact series) -------------------
  async function fetchBls() {
    const ids = [
      ...[TOTAL, ...LABOR.map(x => x.ces)].flatMap(c => [`CES${c}01`, `CES${c}03`]),
      ...Object.values(PPI).map(x => x.id), PPI_SERVICES, ...Object.values(PRS),
    ]
    const y = new Date().getUTCFullYear(), y0 = y - 19, maxS = blsKey ? 50 : 25, span = blsKey ? 20 : 10
    const pts = {}; let requests = 0
    for (let e = y; e >= y0; e -= span) for (let i = 0; i < ids.length; i += maxS) {
      const body = { seriesid: ids.slice(i, i + maxS), startyear: String(Math.max(y0, e - span + 1)), endyear: String(e), ...(blsKey ? { registrationkey: blsKey } : {}) }
      const j = await http(BLS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 60_000 }).then(r => r.json()); requests++
      if (j.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS API: ${scrub((j.message || [j.status]).join('; ')).slice(0, 160)}`)
      for (const s of j.Results?.series || []) for (const p of s.data || []) {
        const v = parseFloat(p.value); if (!fin(v) || !/^\d{4}$/.test(p.year)) continue
        const k = /^M(0[1-9]|1[0-2])$/.test(p.period) ? `${p.year}-${p.period.slice(1)}` : /^Q0[1-4]$/.test(p.period) ? `${p.year}-Q${p.period.slice(2)}` : null
        if (k) (pts[s.seriesID] ||= new Map()).set(k, v)
      }
    }
    const series = {}
    for (const id of ids) { const m = pts[id]; if (!m?.size) continue; const arr = [...m].sort((a, b) => a[0].localeCompare(b[0])); series[id] = enc(arr[0][0].includes('Q') ? 'Q' : 'M', arr) }
    if (!series[`CES${TOTAL}01`]) throw new Error('BLS API: total private employment missing')
    return { block: { asOf: new Date().toISOString(), series, missing: ids.filter(id => !series[id]) }, requests }
  }

  async function fetchQss() {
    const buf = Buffer.from(await (await http(QSS_ZIP, { timeout: 60_000 })).arrayBuffer())
    const t = unzip(buf, /QSS.*\.csv$/i).toString('utf8').split(/\r?\n/)
    const at = name => t.findIndex(l => l.trim() === name)
    const per = {}, cat = {}, dt = {}
    for (let i = at('TIME PERIODS') + 2; i > 1 && /^\d/.test(t[i] || ''); i++) { const [a, b] = t[i].split(','); per[a] = b }
    for (let i = at('CATEGORIES') + 2; i > 1 && /^\d/.test(t[i] || ''); i++) { const r = csvLine(t[i]); cat[r[0]] = r[2] }
    for (let i = at('DATA TYPES') + 2; i > 1 && /^\d/.test(t[i] || ''); i++) { const r = csvLine(t[i]); dt[r[1]] = r[0] }
    const geo = t.slice(at('GEO LEVELS') + 2).find(l => /,US,/.test(l))?.split(',')[0] || '1'
    const updated = t[at('DATA UPDATED ON') + 1]?.trim() || null
    const catOf = {}; for (const q of QSS) { const hit = Object.entries(cat).find(([, d]) => q.re.test(d)); if (hit) catOf[hit[0]] = q.id }
    const rev = {}
    for (let i = at('DATA') + 2; i > 1 && i < t.length; i++) {
      const r = t[i].split(','); if (r.length < 7) continue
      const [p, c, d, e, g, adj, v] = r
      if (d !== dt.QREV || e !== '0' || g !== geo || adj !== '1' || !catOf[c] || !per[p]) continue
      const k = `${per[p].slice(3)}-${per[p].slice(0, 2)}`, x = parseFloat(v) // Q2-2026 → 2026-Q2
      if (fin(x)) (rev[catOf[c]] ||= []).push([k, x])
    }
    const series = Object.fromEntries(Object.entries(rev).map(([id, a]) => [id, enc('Q', a.sort((x, y) => x[0].localeCompare(y[0])))]))
    if (!Object.keys(series).length) throw new Error('QSS: no matching categories')
    return { block: { asOf: new Date().toISOString(), updated, series, missing: QSS.map(q => q.id).filter(id => !series[id]) }, requests: 1 }
  }

  async function fetchIndeed() {
    const [sec, agg] = await Promise.all(['job_postings_by_sector_US.csv', 'aggregate_job_postings_US.csv'].map(f => http(INDEED + f, { timeout: 90_000 }).then(r => r.text())))
    const want = new Set(POSTINGS.map(p => p[0])), cats = {}
    const sl = sec.split(/\r?\n/), sh = csvLine(sl[0]), iD = sh.indexOf('date'), iV = sh.indexOf('indeed_job_postings_index'), iVar = sh.indexOf('variable'), iN = sh.indexOf('display_name')
    if ([iD, iV, iVar, iN].includes(-1)) throw new Error('Indeed sector file: columns changed')
    for (let i = 1; i < sl.length; i++) {
      if (!sl[i]) continue
      const r = csvLine(sl[i]); if (r[iVar] !== 'total postings' || !want.has(r[iN])) continue
      const v = parseFloat(r[iV]); if (fin(v)) (cats[r[iN]] ||= []).push([r[iD], v])
    }
    const al = agg.split(/\r?\n/), ah = csvLine(al[0]), jD = ah.indexOf('date'), jV = ah.indexOf('indeed_job_postings_index_SA'), jVar = ah.indexOf('variable')
    if ([jD, jV, jVar].includes(-1)) throw new Error('Indeed aggregate file: columns changed')
    const total = []
    for (let i = 1; i < al.length; i++) { const r = al[i] && csvLine(al[i]); if (r && r[jVar] === 'total postings' && fin(parseFloat(r[jV]))) total.push([r[jD], parseFloat(r[jV])]) }
    // weekly: every 7th day back from the latest date in the total series
    const end = Date.parse(`${total.map(p => p[0]).sort().at(-1)}T00:00:00Z`)
    const weekly = pts => pts.filter(([d]) => Math.round((end - Date.parse(`${d}T00:00:00Z`)) / DAY) % 7 === 0).sort((a, b) => a[0].localeCompare(b[0]))
    if (!total.length || !Object.keys(cats).length) throw new Error('Indeed: no postings parsed')
    return { block: { asOf: new Date().toISOString(), total: enc('W', weekly(total)), cats: Object.fromEntries(Object.entries(cats).map(([n, p]) => [n, enc('W', weekly(p))])) }, requests: 2 }
  }

  async function fetchNyFed() {
    const files = { unemp: 'college-labor-unemployment-data.csv', under: 'college-labor-underemployment-data.csv' }
    const txt = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([k, f]) => [k, await http(NYFED + f).then(r => r.text())])))
    const series = {}
    for (const j of JUNIORS) {
      const l = txt[j.file].split(/\r?\n/).filter(Boolean), h = csvLine(l[0]).map(s => s.trim()), c = h.indexOf(j.col)
      if (c < 0) continue
      const pts = []
      for (const row of l.slice(1)) { const r = csvLine(row), m = r[0].match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/), v = parseFloat(r[c]); if (m && fin(v)) pts.push([`${m[2]}-${m[1].padStart(2, '0')}`, v]) }
      if (pts.length) series[j.id] = enc('M', pts.sort((a, b) => a[0].localeCompare(b[0])))
    }
    if (!series.recentGrads || !series.allWorkers) throw new Error('NY Fed: unemployment columns changed')
    return { block: { asOf: new Date().toISOString(), series }, requests: 2 }
  }

  // FRED first (shared cache), BEA's keyless flat file for whatever FRED can't give
  async function fetchNipa(prev) {
    const series = {}, src = {}; let requests = 0, beaRequests = 0
    await Promise.all(Object.entries(NIPA).map(async ([k, n]) => {
      try { const obs = typeof fred === 'function' ? await fred(n.fred, 130) : []; requests++
        const pts = (obs || []).filter(o => fin(o.v) && /^\d{4}-\d{2}/.test(o.d)).map(o => [mToQ(o.d.slice(0, 7)), o.v])
        if (pts.length >= 8) { series[k] = enc('Q', pts); src[k] = 'FRED' }
      } catch { /* fall through to BEA */ }
    }))
    const missing = Object.keys(NIPA).filter(k => !series[k])
    let beaAt = prev?.beaAt || null, err = null
    if (missing.length) {
      const reusable = prev && missing.every(k => prev.series?.[k]) && beaAt && Date.now() - Date.parse(beaAt) < BEA_EVERY
      if (reusable) for (const k of missing) { series[k] = prev.series[k]; src[k] = prev.src?.[k] || 'BEA' }
      else {
        try {
          const codes = new Map(missing.map(k => [NIPA[k].bea, k])), got = {}
          const r = await http(BEA_FLAT, { timeout: 180_000 }); beaRequests++
          const dec8 = new TextDecoder(); let rest = ''
          const take = line => { const c = line.slice(0, line.indexOf(',')), k = codes.get(c); if (!k) return
            const m = line.match(/^[^,]+,(\d{4})Q([1-4]),"?([-\d,.]+)"?/); if (m) (got[k] ||= []).push([`${m[1]}-Q${m[2]}`, parseFloat(m[3].replace(/,/g, '')) / 1000]) }
          for await (const chunk of r.body) { const s = rest + dec8.decode(chunk, { stream: true }), ls = s.split('\n'); rest = ls.pop(); for (const l of ls) take(l) }
          if (rest) take(rest)
          for (const k of missing) if (got[k]?.length) { series[k] = enc('Q', got[k].sort((a, b) => a[0].localeCompare(b[0]))); src[k] = 'BEA' }
          beaAt = new Date().toISOString()
        } catch (e) { err = `BEA NIPA flat file: ${e.message}` }
        for (const k of missing) if (!series[k] && prev?.series?.[k]) { series[k] = prev.series[k]; src[k] = `${prev.src?.[k] || 'BEA'} (kept)` }
      }
    }
    if (!Object.keys(series).length) throw new Error(err || 'FRED and BEA both unavailable')
    return { block: { asOf: new Date().toISOString(), beaAt, src, series }, requests, beaRequests, err }
  }

  // S&P 500 revenue per employee: the people screener keeps two fiscal years per company
  function corporate() {
    try {
      const st = JSON.parse(fs.readFileSync(file('sp500-people.json'), 'utf8')), rows = Object.values(st?.rows || {})
      const ok = rows.filter(r => r.employees > 0 && r.empPrev > 0 && r.revenue > 0 && r.revPrev > 0 && fin(r.opInc) && fin(r.opIncPrev))
      if (ok.length < 100) return null
      const fyMode = Object.entries(ok.reduce((m, r) => ((m[r.fy] = (m[r.fy] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0][0]
      const S = k => ok.reduce((s, r) => s + r[k], 0)
      const rpe = [S('revPrev') / S('empPrev'), S('revenue') / S('employees')], opm = [S('opIncPrev') / S('revPrev') * 100, S('opInc') / S('revenue') * 100]
      const pp = [`FY${+fyMode - 1}`, `FY${fyMode}`]
      return {
        asOf: st.ts ? new Date(st.ts).toISOString() : null, n: ok.length,
        source: 'FMP employee counts and income statements via sp500-people.json (server/peopleScreener.js); matched sample, aggregate revenue ÷ aggregate year-end headcount',
        revPerEmployee: pp.map((p, i) => [p, rnd(rpe[i] / 1e3, 1)]), // $ thousands
        opMargin: pp.map((p, i) => [p, rnd(opm[i], 2)]),
        revPerEmployeeChg: rnd(pct(rpe[1], rpe[0]), 1), employeesChg: rnd(pct(S('employees'), S('empPrev')), 1), revenueChg: rnd(pct(S('revenue'), S('revPrev')), 1),
        note: 'Two fiscal years only (the screener keeps the latest and prior year), mostly FY' + fyMode + '; fiscal years end on different dates.',
      }
    } catch { return null }
  }

  // --- derive the page payload from raw blocks ------------------------------
  function derive(R, meta) {
    const B = id => dec(R.bls?.series?.[id])
    const out = { built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], base: BASE }

    // labor
    out.labor = null
    const totE = B(`CES${TOTAL}01`), totW = B(`CES${TOTAL}03`)
    if (totE.length) {
      const ind = LABOR.map(x => ({ ...x, e: B(`CES${x.ces}01`), w: B(`CES${x.ces}03`) })).filter(x => x.e.length)
      const industries = ind.map(x => {
        const es = rebase(ratio(x.e, totE)), ws = x.w.length && totW.length ? rebase(ratio(x.w, totW)) : null
        return {
          id: x.id, label: x.label, naics: x.naics, exposed: x.role === 'exposed', role: x.role,
          emp: from(x.e, OUT_M), ahe: x.w.length ? from(x.w, OUT_M) : null,
          empShareIdx: from(es, OUT_M), wageRelIdx: ws ? from(ws, OUT_M) : null,
          empChg: rnd(last(es)?.[1] - 100, 1), wageRelChg: ws ? rnd(last(ws)?.[1] - 100, 1) : null,
        }
      })
      const pool = role => {
        const g = ind.filter(x => x.role === role); if (!g.length) return null
        const eMaps = g.map(x => new Map(x.e)), wMaps = g.map(x => new Map(x.w)), totWm = new Map(totW)
        const emp = totE.filter(([k]) => eMaps.every(m => fin(m.get(k)))).map(([k, v]) => [k, eMaps.reduce((s, m) => s + m.get(k), 0) / v])
        const w22 = g.map(x => avgYear(x.e)) // fixed 2022 weights strip the cross-industry mix shift
        const wk = totW.map(p => p[0]).filter(k => eMaps.every(m => fin(m.get(k))) && wMaps.every(m => fin(m.get(k))))
        const wage = wk.map(k => [k, eMaps.reduce((s, m, i) => s + m.get(k) * wMaps[i].get(k), 0) / eMaps.reduce((s, m) => s + m.get(k), 0) / totWm.get(k)])
        const fixed = wk.map(k => [k, w22.reduce((s, w, i) => s + w * wMaps[i].get(k), 0) / w22.reduce((s, w) => s + w, 0) / totWm.get(k)])
        const es = rebase(emp), ws = rebase(wage), fx = rebase(fixed)
        const a15 = es.find(p => p[0] === '2015-01'), a19 = es.find(p => p[0] === '2019-12')
        return {
          members: g.map(x => x.id), asOf: last(es)?.[0] || null, aheAsOf: last(ws)?.[0] || null, empShareIdx: from(es, OUT_M), wageRelIdx: from(ws, OUT_M), wageRelIdxFixed: from(fx, OUT_M),
          empChg: rnd(last(es)?.[1] - 100, 1), wageRelChg: rnd(last(ws)?.[1] - 100, 1), wageRelChgFixed: rnd(last(fx)?.[1] - 100, 1),
          // the share's own pace: annualized 2015→2019 vs annualized since mid-2022 (the 2022 average)
          sharePre: rnd(annualized(a15, a19), 2), shareSince2022: rnd(annualized(['2022-07', 100], last(es)), 2),
          jobs: rnd(g.reduce((s, x) => s + (last(x.e)?.[1] || 0), 0), 1),
        }
      }
      out.labor = { asOf: last(totE)[0], aheAsOf: last(totW)?.[0] || null, source: 'BLS Current Employment Statistics (national, seasonally adjusted); average hourly earnings of all employees', industries, composite: pool('exposed'), controls: pool('control'), total: { emp: from(totE, OUT_M), ahe: from(totW, OUT_M) } }
    }

    // postings
    out.postings = null
    const tot = dec(R.indeed?.total)
    if (tot.length) {
      const tl = last(tot), tm = new Map(tot)
      const categories = POSTINGS.filter(([n]) => R.indeed.cats?.[n]).map(([n, exposed]) => {
        const p = dec(R.indeed.cats[n]), l = last(p)
        const ago = p.find(x => Math.round((Date.parse(l[0]) - Date.parse(x[0])) / DAY) === 364)
        const rel = ratio(p, tot), r22 = avgYear(rel)
        return {
          id: n.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''), label: n, exposed, points: roundPts(p, 2),
          vsTotal: tm.get(l[0]) ? rnd(l[1] / tm.get(l[0]), 3) : null, chg1y: ago ? rnd(pct(l[1], ago[1]), 1) : null,
          rel2022: fin(r22) && last(rel) ? rnd(pct(last(rel)[1], r22), 1) : null, // share of all postings vs its 2022 average
        }
      })
      const grp = e => { const g = categories.filter(c => c.exposed === e); return { vsTotal: rnd(mean(g.map(c => c.vsTotal)), 3), rel2022: rnd(mean(g.map(c => c.rel2022)), 1), chg1y: rnd(mean(g.map(c => c.chg1y)), 1) } }
      out.postings = { asOf: tl[0], source: 'Indeed Hiring Lab job postings index (seasonally adjusted, Feb 1 2020 = 100, 7-day trailing average), github.com/hiring-lab/job_postings_tracker', categories, total: roundPts(tot, 2), composite: { exposed: grp(true), controls: grp(false) } }
    }

    // juniors
    out.juniors = null
    const J = id => dec(R.nyfed?.series?.[id])
    const rg = J('recentGrads'), aw = J('allWorkers')
    if (rg.length && aw.length) {
      const gapOf = other => { const om = new Map(other), d = rg.filter(p => fin(om.get(p[0]))).map(([k, v]) => [k, v - om.get(k)]); const pre = mean(d.filter(p => p[0] >= '2015-01' && p[0] <= '2019-12').map(p => p[1])); return { preAI: rnd(pre, 2), now: rnd(last(d)?.[1], 2), at2022: rnd(avgYear(d), 2), series: from(roundPts(d, 2), OUT_JR) } }
      const g = gapOf(aw), gy = J('youngWorkers').length ? gapOf(J('youngWorkers')) : null
      out.juniors = {
        asOf: last(rg)[0], source: 'Federal Reserve Bank of New York, The Labor Market for Recent College Graduates (CPS via IPUMS; SA, 3-month moving average)',
        series: JUNIORS.filter(j => J(j.id).length).map(j => ({ id: j.id, label: j.label, points: from(J(j.id), OUT_JR) })),
        gap: { latest: last(rg)[0], preAI: g.preAI, now: g.now, at2022: g.at2022, chg: rnd(g.now - g.preAI, 2), points: g.series },
        gapYoung: gy ? { preAI: gy.preAI, now: gy.now, at2022: gy.at2022, chg: rnd(gy.now - gy.preAI, 2), points: gy.series } : null,
      }
    }

    // services (QSS revenue, deflated)
    out.services = null
    const ppiQ = Object.fromEntries(Object.entries(PPI).map(([k, p]) => [k, toQuarterly(B(p.id))]))
    const svcQ = toQuarterly(B(PPI_SERVICES))
    if (R.qss?.series) {
      const empQ = id => { const x = LABOR.find(l => l.id === id); return x ? toQuarterly(B(`CES${x.ces}01`)) : [] }
      const rows = QSS.filter(q => R.qss.series[q.id]).map(q => {
        const rev = dec(R.qss.series[q.id]), own = ppiQ[q.id]?.length ? ppiQ[q.id] : null, defl = own || (svcQ.length ? svcQ : null)
        const real = defl ? ratio(rev, rebase(defl, 6).map(([k, v]) => [k, v / 100])) : [] // revenue in 2022 prices ($m)
        const ri = rebase(real), tr = logTrend(ri, '2015-Q1', '2022-Q4')
        // real revenue per worker (2022 = 100) and its pace before vs since 2022
        const e = empQ(q.id), rpw = e.length ? rebase(ratio(real, e)) : []
        const p15 = rpw.find(p => p[0] === '2015-Q1'), p19 = rpw.find(p => p[0] === '2019-Q4')
        return {
          id: q.id, label: q.label, naics: q.naics, role: q.role, exposed: q.role === 'purchased',
          revenue: from(rev, OUT_Q).map(([k, v]) => [k, rnd(v / 1e3, 2)]), // $bn a quarter, SA
          ppi: own ? from(roundPts(own, 3), OUT_Q) : null,
          deflator: own ? PPI[q.id].label : defl ? 'PPI final-demand services (no industry PPI)' : null,
          realIdx: from(ri, OUT_Q), trendIdx: tr ? roundPts(tr.pts, 2) : null, gapToTrend: gapToTrend(ri, tr), trendGrowth: tr ? rnd(tr.annual, 2) : null,
          revPerWorkerIdx: rpw.length ? from(rpw, OUT_Q) : null, revPerWorkerPre: rnd(annualized(p15, p19), 2), revPerWorkerSince2022: rnd(annualized(['2022-Q2', 100], last(rpw)), 2),
          _real: real, _rev: rev, _emp: e,
        }
      })
      // composite of purchased intellectual work: sum of real revenues, employment for revenue per worker
      const P = rows.filter(r => r.role === 'purchased'), keys = [...new Set(P.flatMap(r => r._real.map(p => p[0])))].sort()
      const sumAt = (k, f) => { let s = 0; for (const r of P) { const v = new Map(r[f]).get(k); if (!fin(v)) return null; s += v } return s }
      const realSum = keys.map(k => [k, sumAt(k, '_real')]).filter(p => fin(p[1])), nomSum = keys.map(k => [k, sumAt(k, '_rev')]).filter(p => fin(p[1]))
      const empSum = keys.map(k => [k, sumAt(k, '_emp')]).filter(p => fin(p[1]))
      const ri = rebase(realSum), tr = logTrend(ri, '2015-Q1', '2022-Q4'), rpw = empSum.length ? rebase(ratio(realSum, empSum)) : []
      const p15 = rpw.find(p => p[0] === '2015-Q1'), p19 = rpw.find(p => p[0] === '2019-Q4')
      for (const r of rows) { delete r._real; delete r._rev; delete r._emp }
      out.services = {
        asOf: last(dec(R.qss.series.legal || Object.values(R.qss.series)[0]))?.[0] || null, updated: R.qss.updated || null,
        source: 'Census Quarterly Services Survey (total revenue, SA) deflated by BLS industry PPIs; revenue per worker uses CES employment',
        industries: rows,
        composite: {
          members: P.map(r => r.id), realIdx: from(ri, OUT_Q), trendIdx: tr ? roundPts(tr.pts, 2) : null, gapToTrend: gapToTrend(ri, tr), trendGrowth: tr ? rnd(tr.annual, 2) : null,
          nominalIdx: from(rebase(nomSum), OUT_Q), revPerWorkerIdx: from(rpw, OUT_Q), revPerWorkerPre: rnd(annualized(p15, p19), 2), revPerWorkerSince2022: rnd(annualized(['2022-Q2', 100], last(rpw)), 2),
        },
      }
    }

    // macro
    const N = k => dec(R.nipa?.series?.[k])
    const prod = B(PRS.productivity), ls = B(PRS.laborShare), ulc = B(PRS.ulc)
    const yoy = pts => { const m = new Map(pts); return pts.map(([k, v]) => [k, m.get(qKey(qOrd(k) - 4))]).filter(p => fin(p[1])).map(([k, v0]) => [k, rnd(pct(m.get(k), v0), 2)]) }
    const profitsShare = ratio(N('profits'), N('gdp')).map(([k, v]) => [k, rnd(v * 100, 2)])
    const compShare = ratio(N('coe'), N('gdi')).map(([k, v]) => [k, rnd(v * 100, 2)])
    const sw = N('software'), swT = logTrend(sw, '2010-Q1', '2022-Q4'), swr = N('softwareReal'), swrT = logTrend(swr, '2010-Q1', '2022-Q4')
    const svcM = B(PPI_SERVICES), svcR = rebase(svcM), exR = EXPOSED_PPI.map(k => new Map(rebase(B(PPI[k].id)))).filter(m => m.size)
    const exposedPpi = exR.length ? svcR.map(([k]) => [k, exR.map(m => m.get(k))]).filter(([, a]) => a.every(fin)).map(([k, a]) => [k, rnd(mean(a), 2)]) : []
    const q = k => prod.find(p => p[0] === k)
    const anyMacro = prod.length || ls.length || profitsShare.length || sw.length || svcM.length
    out.macro = !anyMacro ? null : {
      asOf: last(prod)?.[0] || last(profitsShare)?.[0] || null, nipaSource: R.nipa?.src || null,
      laborShare: from(ls, '2007-Q1'), laborShareChg: ls.length ? rnd(pct(last(ls)[1], avgYear(ls)), 2) : null,
      productivityYoy: from(yoy(prod), '2008-Q1'), unitLaborCostYoy: from(yoy(ulc), '2008-Q1'),
      productivity: prod.length ? { pre: rnd(annualized(q('2009-Q4'), q('2019-Q4')), 2), since2023: rnd(annualized(q('2022-Q4'), last(prod)), 2), latest: last(prod)[0], note: 'nonfarm business output per hour, annualized: 2009Q4→2019Q4 vs 2022Q4→latest' } : null,
      profitsShare: from(profitsShare, '2000-Q1'), profitsShareChg: profitsShare.length ? rnd(last(profitsShare)[1] - avgYear(profitsShare), 2) : null,
      compShare: compShare.length ? from(compShare, '2000-Q1') : null, compShareChg: compShare.length ? rnd(last(compShare)[1] - avgYear(compShare), 2) : null,
      software: from(roundPts(sw, 1), '2010-Q1'), softwareTrend: swT ? roundPts(swT.pts, 1) : null, softwareGap: gapToTrend(sw, swT), softwareTrendGrowth: swT ? rnd(swT.annual, 2) : null,
      softwareRealGap: gapToTrend(swr, swrT),
      servicesPpi: from(svcR, OUT_M), exposedPpi: from(exposedPpi, OUT_M),
      servicesPpiChg: svcR.length ? rnd(last(svcR)[1] - 100, 1) : null, exposedPpiChg: exposedPpi.length ? rnd(last(exposedPpi)[1] - 100, 1) : null,
      exposedPpiMembers: EXPOSED_PPI,
    }

    out.corporate = corporate()
    out.scorecard = scorecard(out)
    out.sources = meta.sources || []
    out.note = 'Exposure is classified by industry, not by task or occupation: an "exposed" industry still employs many people AI does not touch, and a control industry is only low-exposure on average. ' +
      'Average hourly earnings are averages, so they rise when low-paid workers leave (the composition effect the fingerprint looks for) and also with ordinary mix shifts; the fixed-weight composite removes the cross-industry part only. ' +
      'Shares of total private employment fall for any industry when health care grows fast (it has, for demographic reasons), and 2022 was a tech hiring peak followed by a rate shock — both push the same way as AI substitution. ' +
      'QSS revenue is nominal; real revenue divides by industry PPIs that BLS quality-adjusts imperfectly and that, for services, largely track wages — so real output of AI-assisted work is probably understated, which is the dark-output point itself. ' +
      'BLS has no PPI for computer systems design, accounting as a whole (offices of CPAs stand in), business support or office administration; computer systems design is deflated by final-demand services. ' +
      'Postings are Indeed\'s own occupational categories, not NAICS. The NY Fed series are 3-month moving averages from CPS microdata and are revised. ' +
      'The S&P 500 comparison spans only two fiscal years. Fingerprints 3 (purchased work moving in-house) and 4 (sector misrouting) have no public series and are not scored.'
    return out
  }

  // --- the honest read: one line per fingerprint -----------------------------
  function scorecard(o) {
    const S = [], f1 = v => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a'), f2 = v => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : 'n/a')
    const add = (id, label, reading, signal, why) => S.push({ id, label, reading, signal, why })
    const L = o.labor?.composite, C = o.labor?.controls
    if (L && fin(L.empChg) && fin(L.wageRelChg)) {
      const e = L.empChg, w = L.wageRelChg, wf = L.wageRelChgFixed
      // the fingerprint industry by industry: jobs share down ≥3% and relative pay up ≥1%
      const hits = (o.labor.industries || []).filter(i => i.role === 'exposed' && i.empChg <= -3 && i.wageRelChg >= 1)
      const hitTxt = hits.length ? `; fingerprint in ${hits.map(i => `${i.label[0].toLowerCase() + i.label.slice(1)} (${f1(i.empChg)}% / ${f1(i.wageRelChg)}%)`).join(', ')}` : ''
      const reading = `Exposed share of private jobs ${f1(e)}% since 2022 (pace ${f2(L.sharePre)}%/yr in 2015–19, ${f2(L.shareSince2022)}%/yr since), relative pay ${f1(w)}% (fixed-weight ${f1(wf)}%); controls ${f1(C?.empChg)}% / ${f1(C?.wageRelChg)}%${hitTxt}`
      if (e <= -3 && w >= 1) add('jobs', 'Exposed-industry jobs vs pay', reading, 'dark output', 'Jobs share down ≥3% while relative pay rose ≥1%: the fingerprint of the cheapest workers leaving. Rate-driven tech layoffs of junior staff produce the same pattern.')
      else if (e <= -3) add('jobs', 'Exposed-industry jobs vs pay', reading, 'nothing yet', `The exposed fields are losing share of private jobs, a reversal of their pre-2020 growth, but pooled relative pay is not rising, so it reads as weaker demand more than juniors being replaced${hits.length ? ` — except in ${hits.map(i => i.label[0].toLowerCase() + i.label.slice(1)).join(' and ')}, where the full fingerprint shows` : ''}. Fast health-care growth lowers every other industry's share.`)
      else add('jobs', 'Exposed-industry jobs vs pay', reading, 'nothing yet', `Exposed fields have not lost ground on the rest of the private economy${hits.length ? `; only ${hits.map(i => i.label[0].toLowerCase() + i.label.slice(1)).join(' and ')} show the fingerprint` : ''}.`)
    } else add('jobs', 'Exposed-industry jobs vs pay', 'BLS employment unavailable', 'no data', 'BLS CES did not load.')

    const G = o.juniors?.gap, GY = o.juniors?.gapYoung
    if (G && fin(G.now) && fin(G.preAI)) {
      const reading = `Recent grads − all workers: ${f2(G.now)} pp (${G.latest}) vs ${f2(G.preAI)} pp in 2015–19, ${f2(G.at2022)} pp in 2022; vs young non-grads ${f2(GY?.now)} pp (was ${f2(GY?.preAI)})`
      const by22 = fin(G.at2022) ? G.at2022 - G.preAI : null, since = fin(G.at2022) ? G.now - G.at2022 : null
      if (G.chg >= 0.75 && (!GY || GY.chg >= 0.75)) add('juniors', 'Recent-graduate unemployment gap', reading, 'dark output', `New graduates are faring worse than all workers, and than non-graduate peers, by more than before 2020: entry-level substitution fits.${fin(by22) ? ` Of the ${f2(G.chg)} pp widening, ${f2(by22)} pp came before 2023 and ${f2(since)} pp since,` : ''} and junior hiring is also the first thing firms cut in a slowdown.`)
      else add('juniors', 'Recent-graduate unemployment gap', reading, 'nothing yet', 'The recent-graduate gap is within ¾ pp of its 2015–19 norm (against all workers or against non-graduate peers).')
    } else add('juniors', 'Recent-graduate unemployment gap', 'NY Fed data unavailable', 'no data', 'The NY Fed college labor market CSVs did not load.')

    const PE = o.postings?.composite?.exposed, PC = o.postings?.composite?.controls
    if (PE && fin(PE.rel2022)) {
      const cat = n => o.postings.categories.find(c => c.label === n), pick = ['Software Development', 'Legal', 'Administrative Assistance', 'Customer Service'].map(cat).filter(Boolean)
      const reading = `Exposed occupations' share of postings ${f1(PE.rel2022)}% vs 2022 (controls ${f1(PC?.rel2022)}%); vs total (Feb 2020 = 1): ${pick.map(c => `${c.label} ${c.vsTotal}×`).join(', ')}`
      const diff = PE.rel2022 - (PC?.rel2022 ?? 0)
      if (PE.rel2022 <= -15 && diff <= -10) add('postings', 'Postings for exposed occupations', reading, 'dark output', 'Exposed occupations are a much smaller share of new openings than in 2022 while the controls are not — consistent with less hiring for AI-doable work, but 2022 was a tech hiring peak and the rate shock hit these fields first.')
      else add('postings', 'Postings for exposed occupations', reading, 'nothing yet', 'Exposed occupations have not lost share of postings by much more than the controls since 2022.')
    } else add('postings', 'Postings for exposed occupations', 'Indeed data unavailable', 'no data', 'Indeed Hiring Lab CSVs did not load.')

    const SV = o.services?.composite
    if (SV && fin(SV.gapToTrend)) {
      const P = (o.services.industries || []).filter(i => i.role === 'purchased' && fin(i.gapToTrend))
      const reading = `Real revenue of purchased professional work ${f1(SV.gapToTrend)}% vs its 2015–22 trend (${f2(SV.trendGrowth)}%/yr): ${P.map(i => `${i.label[0].toLowerCase() + i.label.slice(1)} ${f1(i.gapToTrend)}%`).join(', ')}`
      const below = P.filter(i => i.gapToTrend <= -5).map(i => i.label[0].toLowerCase() + i.label.slice(1))
      if (SV.gapToTrend <= -5) add('receipts', 'Receipts for purchased intellectual work', reading, 'dark output', 'Real spending on legal, accounting, IT design, consulting and advertising is running well below trend: receipts are disappearing, the substitution signature (or a slump in demand).')
      else if (SV.gapToTrend <= -2) add('receipts', 'Receipts for purchased intellectual work', reading, 'nothing yet', `Slightly below trend, inside the 5% line${below.length ? `; ${below.join(' and ')} are well below it` : ''}. Watch, not yet a signal of less spending on intellectual work.`)
      else add('receipts', 'Receipts for purchased intellectual work', reading, 'nothing yet', 'Firms are still buying as much outside intellectual work as the pre-AI trend implies; the "less spending on intellectual work" thesis is not visible in receipts yet.')
    } else add('receipts', 'Receipts for purchased intellectual work', 'QSS unavailable', 'no data', 'Census QSS did not load.')

    if (SV && fin(SV.revPerWorkerSince2022) && fin(SV.revPerWorkerPre)) {
      const acc = SV.revPerWorkerSince2022 - SV.revPerWorkerPre
      const reading = `Real revenue per worker ${f2(SV.revPerWorkerSince2022)}%/yr since 2022 vs ${f2(SV.revPerWorkerPre)}%/yr in 2015–19`
      if (acc >= 1.5 && SV.gapToTrend > -5) add('revPerWorker', 'Revenue per worker in exposed services', reading, 'captured', 'The same (or more) real receipts are coming from fewer people faster than before: sellers are keeping the price and the savings.')
      else add('revPerWorker', 'Revenue per worker in exposed services', reading, 'nothing yet', 'Revenue per worker is not accelerating by more than 1.5 pp a year over its pre-2020 pace.')
    } else add('revPerWorker', 'Revenue per worker in exposed services', 'QSS or CES unavailable', 'no data', 'Needs both Census QSS and BLS employment.')

    const M = o.macro
    if (M && fin(M.exposedPpiChg) && fin(M.servicesPpiChg)) {
      const d = M.exposedPpiChg - M.servicesPpiChg
      const reading = `Exposed-service PPIs ${f1(M.exposedPpiChg)}% since 2022 vs all services ${f1(M.servicesPpiChg)}%`
      if (d >= -2 && fin(L?.empChg) && L.empChg <= -3) add('prices', 'Exposed service prices', reading, 'captured', 'Prices are holding while the exposed workforce shrinks: no measured pass-through, so any savings sit with the seller (or, if customers do the work themselves, vanish from the accounts).')
      else if (d <= -5) add('prices', 'Exposed service prices', reading, 'nothing yet', 'Exposed-service prices are falling behind services overall: pass-through the price statistics can see, not dark.')
      else if (d < -2) add('prices', 'Exposed service prices', reading, 'nothing yet', `Exposed-service prices have risen ${Math.abs(d).toFixed(1)} pp less than services overall: mild relative disinflation, too small to call measured pass-through. The PPIs mostly track wages, as the dark-output argument predicts.`)
      else add('prices', 'Exposed service prices', reading, 'nothing yet', 'Exposed-service prices are moving with services overall — the PPIs are behaving like wage indexes, as the dark-output argument predicts, but that alone is not evidence of AI.')
    } else add('prices', 'Exposed service prices', 'PPI unavailable', 'no data', 'BLS PPIs did not load.')

    if (M && fin(M.softwareGap)) {
      const reading = `Software investment ${f1(M.softwareGap)}% vs its 2010–22 trend (${f2(M.softwareTrendGrowth)}%/yr); real ${f1(M.softwareRealGap)}%`
      if (M.softwareGap <= 7) add('software', 'Software investment vs the token boom', reading, 'dark output', `Token volumes have multiplied since 2023 but measured software investment is ${M.softwareGap >= 0 ? `only ${M.softwareGap.toFixed(1)}% above` : `${Math.abs(M.softwareGap).toFixed(1)}% below`} its pre-ChatGPT trend — the gap SemiAnalysis points to. The inference only holds if that token use is productive work.`)
      else add('software', 'Software investment vs the token boom', reading, 'nothing yet', 'Software investment is running well above trend: AI spending is showing up in the measured accounts.')
    } else add('software', 'Software investment vs the token boom', 'Software investment unavailable', 'no data', 'FRED and the BEA flat file both failed.')

    const PR = M?.productivity
    if (PR && fin(PR.pre) && fin(PR.since2023)) {
      const acc = PR.since2023 - PR.pre
      const reading = `Productivity ${f2(PR.since2023)}%/yr since 2022Q4 vs ${f2(PR.pre)}%/yr in 2009Q4–2019Q4; labor share ${f2(M.laborShareChg)}% vs 2022`
      if (acc >= 0.5 && fin(M.laborShareChg) && M.laborShareChg <= -1) add('productivity', 'Measured productivity', reading, 'captured', 'Measured output per hour has accelerated and labor\'s share has fallen: the gains are visible and going to capital.')
      else if (acc >= 0.5) add('productivity', 'Measured productivity', reading, 'nothing yet', 'Measured productivity has accelerated — part of the gain is visible, not dark — and labor is keeping its share.')
      else add('productivity', 'Measured productivity', reading, 'nothing yet', 'No measured acceleration over the 2010s pace.')
    } else add('productivity', 'Measured productivity', 'BLS productivity unavailable', 'no data', 'BLS PRS series did not load.')

    if (M && fin(M.laborShareChg) && fin(M.profitsShareChg)) {
      const reading = `Labor share ${f2(M.laborShareChg)}% vs 2022; after-tax profits ${last(M.profitsShare)?.[1] ?? 'n/a'}% of GDP (${f2(M.profitsShareChg)} pp vs 2022)${fin(M.compShareChg) ? `; compensation ${f2(M.compShareChg)} pp of GDI` : ''}`
      if (M.laborShareChg <= -1 && M.profitsShareChg >= 0.5) add('shares', 'Labor share vs profits share', reading, 'captured', 'Income is shifting from wages to profits: firms are keeping the savings, which supports earnings — and is the case for S&P margins holding.')
      else if (M.profitsShareChg >= 0.5) add('shares', 'Labor share vs profits share', reading, 'nothing yet', 'Profits are up as a share of GDP but labor share has not fallen by 1%: margins are rising without a clear squeeze on labor.')
      else add('shares', 'Labor share vs profits share', reading, 'nothing yet', 'No shift of income from labor to profits since 2022.')
    } else add('shares', 'Labor share vs profits share', 'Income shares unavailable', 'no data', 'BLS labor share or FRED/BEA profits did not load.')

    const K = o.corporate
    if (K && fin(K.revPerEmployeeChg)) {
      const dm = K.opMargin[1][1] - K.opMargin[0][1]
      const reading = `S&P 500 revenue per employee ${f1(K.revPerEmployeeChg)}% ${K.revPerEmployee[0][0]}→${K.revPerEmployee[1][0]} ($${K.revPerEmployee[1][1]}k); headcount ${f1(K.employeesChg)}%, operating margin ${f2(dm)} pp (n=${K.n})`
      if (K.revPerEmployeeChg >= 3 && dm >= 0.5 && K.employeesChg <= 1) add('corporate', 'S&P 500 revenue per employee', reading, 'captured', 'Big companies grew revenue without adding staff and widened margins — what captured AI savings would look like (one year, and price increases do the same).')
      else add('corporate', 'S&P 500 revenue per employee', reading, 'nothing yet', 'Revenue per employee and margins did not move together enough to read as captured savings (one year only).')
    } else add('corporate', 'S&P 500 revenue per employee', 'People screener cache unavailable', 'no data', 'sp500-people.json missing or too thin.')

    add('boundary', 'Purchased work moving in-house', 'No public series', 'no data', 'Would need firm-level purchases of professional services against in-house headcount by occupation; not published.')
    add('misrouting', 'Sector misrouting', 'No public series', 'no data', 'Output booked to the wrong industry (e.g. AI work recorded as software or cloud revenue) cannot be seen in public aggregates.')
    return S
  }

  // --- build: every source independently, falling back to its last good block -
  async function build() {
    const prevAll = raw || load(CACHE)?.raw || null, seed = load(SEED)?.raw || null
    const R = {}, errs = [], sources = [], requests = { bls: 0, census: 0, indeed: 0, nyfed: 0, fred: 0, bea: 0 }
    const jobs = {
      bls: ['BLS API v2 (CES, PPI, productivity)', BLS_API, () => fetchBls()],
      qss: ['Census Quarterly Services Survey', QSS_ZIP, () => fetchQss()],
      indeed: ['Indeed Hiring Lab postings', INDEED, () => fetchIndeed()],
      nyfed: ['NY Fed recent college graduates', NYFED, () => fetchNyFed()],
      nipa: ['FRED / BEA NIPA (profits, GDP, software)', 'FRED via shared cache; ' + BEA_FLAT, () => fetchNipa(prevAll?.nipa || seed?.nipa)],
    }
    const cnt = { bls: 'bls', qss: 'census', indeed: 'indeed', nyfed: 'nyfed' }
    const res = await Promise.allSettled(Object.values(jobs).map(j => j[2]()))
    Object.keys(jobs).forEach((k, i) => {
      const r = res[i], [label, url] = jobs[k]
      if (r.status === 'fulfilled') {
        R[k] = r.value.block
        if (k === 'nipa') { requests.fred += r.value.requests; requests.bea += r.value.beaRequests; if (r.value.err) errs.push(r.value.err) } else requests[cnt[k]] += r.value.requests
        sources.push({ id: k, label, url, fetched: R[k].asOf, from: 'live' })
      } else {
        const msg = scrub(r.reason?.message || r.reason)
        const fb = prevAll?.[k] ? ['cache', prevAll[k]] : seed?.[k] ? ['seed', seed[k]] : null
        if (fb) R[k] = fb[1]
        errs.push(`${label}: ${msg}${fb ? ` — serving the ${fb[0]} copy fetched ${String(fb[1].asOf || '').slice(0, 10)}` : ' — no fallback'}`)
        sources.push({ id: k, label, url, fetched: fb?.[1]?.asOf || null, from: fb ? fb[0] : 'none' })
      }
    })
    const payload = derive(R, { stale: errs.length > 0, sourceErrors: errs, sources })
    payload.requests = requests
    return { payload, raw: R, failed: errs.length > 0 }
  }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const { payload, raw: R, failed } = await build()
        mem = payload; raw = R; nextAt = Date.now() + (failed ? RETRY : TTL)
        save(CACHE, { version: 1, nextAt, payload, raw: R })
        return payload
      } catch (e) {
        console.warn('Dark output:', e.message)
        nextAt = Date.now() + RETRY
        if (mem) return { ...mem, stale: true, sourceErrors: [...(mem.sourceErrors || []), `refresh failed: ${scrub(e.message)}`] }
        const seed = load(SEED)?.raw
        if (seed) { mem = derive(seed, { stale: true, sourceErrors: [`refresh failed: ${scrub(e.message)} — serving the tracked seed`], sources: [] }); return mem }
        throw e
      } finally { inflight = null }
    })()
    return inflight
  }

  async function get() {
    if (!mem) {
      const disk = load(CACHE)
      if (disk?.version === 1 && disk.payload?.built) {
        // re-derive from the cached raw series so a code change shows without refetching
        const p = disk.payload
        try { mem = disk.raw ? { ...derive(disk.raw, { stale: p.stale, sourceErrors: p.sourceErrors, sources: p.sources }), built: p.built, requests: p.requests } : p } catch (e) { console.warn('Dark output re-derive:', e.message); mem = p }
        raw = disk.raw || null; nextAt = disk.nextAt || Date.parse(p.built) + TTL
      }
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  // the raw blocks behind the payload (for writing the tracked seed)
  const rawBlocks = () => raw
  return { get, rawBlocks }
}
