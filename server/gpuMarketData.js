// ============================================================================
// GPU MARKET DATA — how scarce GPU capacity is, what it lists for across ~40
// providers by term, and what used GPUs sell for
//   shadeform  api.shadeform.ai/v1/instances/types (keyless; the OpenAPI spec
//              declares no auth): every GPU instance type on ~18 clouds, its
//              list price (in CENTS per instance-hour) and, per region, whether
//              it can be launched now. Per GPU model: instance-type × region
//              rows, how many are available, the share available, list price
//              per GPU-hour (instance price ÷ GPUs in it) min / median / max over
//              listings (each cloud × instance type once, whatever its region
//              count), the cheapest and median price among listings available
//              now (availMin, availMedian: cheap capacity selling out shows here
//              before list prices move), the SXM/PCIe split where a model comes
//              in both, and per cloud rows / available / cheapest per-GPU price.
//              On-demand rows only (a handful of spot rows carry their own
//              price and are left out). Shadeform states no terms of use, so the
//              tracked archive keeps summary numbers only.
//   getdeploying  getdeploying.com/dataset/gpu-prices/weekly.csv (CC BY 4.0,
//              credit required: ATTRIB_GD): 53 trailing weeks per GPU model of
//              min / median / max list price per GPU-hour across ~88 providers,
//              by billing type — on-demand, spot, reservations of 1–60 months,
//              reservations of unstated term ('reserved'), 'custom' quotes.
//              median = median over listings, pMedian = median of each
//              provider's own median, n = providers, offers = listings (priced,
//              not marked sold out; advertised, not checked as rentable). Kept:
//              the data-center and main rental models (KEEP_GD). The latest week
//              is partial until its Sunday is captured (latestPartial).
//              termStructure = latest week's on-demand (months 0) and fixed-term
//              reservation medians; yoy = on-demand median now vs 52 weeks back
//              (±2 weeks), or vs its first week for models listed under a year.
//              The weekly file already holds every model's 53 weeks, so the
//              per-model <slug>.csv files are not fetched.
//   resale     amcompute.com/gpu-resale-index/data.csv ("free to use with
//              attribution", ATTRIB_AM): monthly index of what a fixed basket of
//              used data center GPUs (T4 … H100, 2.5–8 years old) sells for as
//              a share of its price new, H1 2025 = 100, with vs_baseline_pct
//              (premium/discount to normal depreciation); ~13 months, restated
//              as late sales come in. The used-H100 headline (single H100 SXM
//              realized sale, 25th percentile, dealer ask; 8-GPU HGX H100 node)
//              is not on the index page: it is read from the H100 appraisal page
//              (amcompute.com/appraisals/h100), same Rack Report.
// Cadence: stale-while-revalidate, per source: Shadeform every 2 hours
// (availability moves), GetDeploying and AmCompute daily. The first GET with
// nothing on disk waits; after that an expired source is refetched in the
// background and the last good data is served (stale: true). A failed source
// waits 10 minutes before the next try. A source that fails is a null block
// (when it has never loaded) plus a line in sourceErrors, never a throw once any
// data exists. Requests per refresh: Shadeform 1 (~260 KB), GetDeploying 1
// (~1.1 MB CSV), AmCompute 2 (CSV ~0.5 KB + appraisal page ~180 KB). Browser UA.
// Files (repo root):
//   gpu-market-data.json            the cache (all three sources, gitignored —
//                                   GetDeploying's dataset is not committed)
//   data/ai/gpu-availability-daily.json  TRACKED archive: one row per UTC day
//                                   per GPU { d, gpu, rows, available, share,
//                                   listMin, listMedian, availMin }; the last
//                                   refresh of the day wins; one row per line.
//                                   Never written over when it cannot be read.
// Every write is a temp file renamed in.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const SF_URL = 'https://api.shadeform.ai/v1/instances/types'
const GD_URL = 'https://getdeploying.com/dataset/gpu-prices/weekly.csv'
const AM_CSV = 'https://www.amcompute.com/gpu-resale-index/data.csv'
const AM_H100 = 'https://www.amcompute.com/appraisals/h100'
export const ATTRIB_GD = 'GetDeploying, getdeploying.com, CC BY 4.0'
export const ATTRIB_AM = 'AmCompute GPU Resale Index'
const MIN = 60e3, H = 60 * MIN, DAY = 24 * H
const TTL = { shadeform: 2 * H, getdeploying: DAY, resale: DAY }
const RETRY_AFTER = 10 * MIN
const NAMES = { shadeform: 'Shadeform instance availability', getdeploying: 'GetDeploying GPU price dataset', resale: 'AmCompute GPU Resale Index' }

const fin = v => v != null && Number.isFinite(v)
const r3 = v => (fin(v) ? Math.round(v * 1000) / 1000 : null)
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const ORDER = ['GB300', 'B300', 'GB200', 'B200', 'H200', 'GH200', 'H100', 'H100 NVL', 'A100', 'A100 40GB', 'MI355X', 'MI350X', 'MI325X', 'MI300X', 'RTX PRO 6000', 'L40S', 'RTX 5090', 'RTX 4090']
const rank = g => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i }
const byRank = (a, b) => rank(a) - rank(b) || a.localeCompare(b)
// archived per day (Shadeform) and kept in the GetDeploying block
const KEEP_SF = new Set(ORDER)
const KEEP_GD = new Set(ORDER)

// Shadeform gpu_type → common name: H100_nvl → H100 NVL, A100_80G → A100 (40 GB parts → A100 40GB),
// V100_32G → V100 32GB, RTXPro6000 → RTX PRO 6000, RTX6000Ada → RTX 6000 Ada, GAUDI2 → Gaudi2
function sfGpu(type, vram) {
  const s = String(type || '').trim()
  if (/^A100(_\d+G)?$/i.test(s)) return fin(vram) && vram < 60 ? 'A100 40GB' : 'A100'
  const rtx = s.match(/^RTX(Pro)?(\d{4})(Ada)?$/i)
  if (rtx) return `RTX${rtx[1] ? ' PRO' : ''} ${rtx[2]}${rtx[3] ? ' Ada' : ''}`
  if (/^gaudi/i.test(s)) return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  // GB200_nvl72-style rack types fold into their chip (GB200)
  return s.replace(/_nvl$/i, ' NVL').replace(/_(\d+)G$/i, ' $1GB').replace(/_/g, ' ').toUpperCase().replace(/^(GB\d{3}) NVL\d+$/, '$1')
}
// GetDeploying slug → common name: nvidia-h100 → H100, amd-mi300x → MI300X, nvidia-rtx-pro-6000 → RTX PRO 6000,
// nvidia-rtx-4070-ti-super → RTX 4070 Ti Super, intel-gaudi2 → Gaudi2
function gdGpu(slug) {
  const s = String(slug || '').replace(/^(nvidia|amd|intel)-/, '')
  if (/^gaudi/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1)
  return s.split('-').map(w => (/^(ti|ada|super|sff)$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ')
}
// billing_type + reservation_months → kind: on-demand, spot, reserved-12m, reserved (term not stated), custom …
function gdKind(bt, months) {
  const b = String(bt || '').toUpperCase(), m = parseInt(months, 10)
  if (b === 'ON_DEMAND') return 'on-demand'
  if (b === 'SPOT') return 'spot'
  if (b === 'CUSTOM') return 'custom'
  if (b === 'RESERVATION') return fin(m) ? `reserved-${m}m` : 'reserved'
  const rm = b.match(/^RESERVATION_(\d+)_MONTHS?$/)
  if (rm) return `reserved-${+rm[1]}m`
  return b.toLowerCase().replace(/_/g, '-')
}
const kindMonths = k => (k === 'on-demand' ? 0 : +(k.match(/^reserved-(\d+)m$/)?.[1] ?? NaN))
const kindRank = k => (k === 'on-demand' ? 0 : k === 'spot' ? 1 : fin(kindMonths(k)) ? 10 + kindMonths(k) : k === 'reserved' ? 900 : 1000)
const stripHtml = h => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const money = s => (s == null ? null : +String(s).replace(/[$,]/g, ''))
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const ym = s => { const m = String(s || '').match(/([A-Za-z]+)\s+(\d{4})/); const i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1; return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : null }

// a minimal CSV reader (quoted fields allowed); '#' comment lines skipped
function parseCsv(text) {
  const rows = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const out = []; let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur); rows.push(out)
  }
  const [head, ...body] = rows
  return (body || []).map(r => Object.fromEntries((head || []).map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

export function createGpuMarketData({ UA, dir }) {
  const file = n => path.join(dir, n)
  const CACHE = 'gpu-market-data.json', ARCHIVE = path.join('data', 'ai', 'gpu-availability-daily.json')
  const writeAtomic = (n, text) => {
    const f = file(n), tmp = path.join(path.dirname(f), `${path.basename(f, '.json')}.tmp-${process.pid}.json`)
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(tmp, text); fs.renameSync(tmp, f)
  }
  // parts[k] = { data, fetched } — the last good build of each source
  let parts = null
  const state = { shadeform: {}, getdeploying: {}, resale: {} } // { inflight, error, errorAt }

  function loadCache() {
    if (parts) return parts
    parts = { shadeform: null, getdeploying: null, resale: null }
    try {
      if (fs.existsSync(file(CACHE))) {
        const c = JSON.parse(fs.readFileSync(file(CACHE), 'utf8'))
        for (const k of Object.keys(parts)) if (c?.parts?.[k]?.data && c.parts[k].fetched) parts[k] = c.parts[k]
      }
    } catch (e) { console.warn(`${CACHE}: ${e.message}`) }
    return parts
  }
  const saveCache = () => { try { writeAtomic(CACHE, JSON.stringify({ saved: new Date().toISOString(), parts })) } catch (e) { console.error(`${CACHE} save:`, e.message) } }

  async function fetchText(url, { accept = 'application/json, text/csv;q=0.9, */*;q=0.8', timeout = 45_000 } = {}) {
    for (let a = 0; ; a++) {
      let r
      try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) }) }
      catch (e) { if (a < 1) { await new Promise(res => setTimeout(res, 2000)); continue } throw new Error(`${new URL(url).host}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`) }
      if (r.ok) return r.text()
      if ((r.status >= 500 || r.status === 429) && a < 2) { await new Promise(res => setTimeout(res, 1500 * (a + 1))); continue }
      throw new Error(`${new URL(url).host}: HTTP ${r.status}`)
    }
  }

  // ── Shadeform: availability and list prices per GPU model ──
  let archiveBroken = null
  async function buildShadeform() {
    const j = JSON.parse(await fetchText(SF_URL))
    const types = Array.isArray(j?.instance_types) ? j.instance_types : null
    if (!types?.length) throw new Error('Shadeform: no instance types listed')
    const listings = []
    for (const t of types) {
      const c = t.configuration || {}
      const n = +(t.num_gpus ?? c.num_gpus), cents = +t.hourly_price, type = t.gpu_type ?? c.gpu_type
      if (!(n > 0) || !(cents > 0) || !type || /^cpu$/i.test(type)) continue
      const regions = (t.availability || []).filter(a => (a.rental_type || 'on_demand') === 'on_demand')
      if (!regions.length) continue
      const ic = String(t.interconnect ?? c.interconnect ?? '')
      listings.push({
        gpu: sfGpu(type, +(c.vram_per_gpu_in_gb)), cloud: t.cloud, form: /sxm/i.test(ic) ? 'SXM' : /pcie/i.test(ic) ? 'PCIe' : null,
        perGpu: cents / 100 / n, rows: regions.length, available: regions.filter(a => a.available === true).length,
      })
    }
    if (!listings.length) throw new Error('Shadeform: no priced GPU instance types')
    const summarize = ls => {
      const rows = ls.reduce((s, l) => s + l.rows, 0), available = ls.reduce((s, l) => s + l.available, 0)
      const px = ls.map(l => l.perGpu), av = ls.filter(l => l.available > 0).map(l => l.perGpu)
      return { rows, available, share: rows ? r3(available / rows) : null, listMin: r3(Math.min(...px)), listMedian: r3(median(px)), listMax: r3(Math.max(...px)), availMin: av.length ? r3(Math.min(...av)) : null, availMedian: r3(median(av)) }
    }
    const byGpu = {}
    for (const g of [...new Set(listings.map(l => l.gpu))].sort(byRank)) {
      const ls = listings.filter(l => l.gpu === g)
      const clouds = [...new Set(ls.map(l => l.cloud))].map(cloud => {
        const cl = ls.filter(l => l.cloud === cloud)
        return { cloud, rows: cl.reduce((s, l) => s + l.rows, 0), available: cl.reduce((s, l) => s + l.available, 0), minPerGpu: r3(Math.min(...cl.map(l => l.perGpu))) }
      }).sort((a, b) => b.available - a.available || a.minPerGpu - b.minPerGpu)
      const out = { ...summarize(ls), listings: ls.length, clouds }
      const forms = [...new Set(ls.map(l => l.form).filter(Boolean))]
      if (forms.length > 1) out.forms = Object.fromEntries(forms.sort().map(f => { const s = summarize(ls.filter(l => l.form === f)); return [f, { rows: s.rows, available: s.available, share: s.share, listMin: s.listMin, listMedian: s.listMedian }] }))
      byGpu[g] = out
    }
    const asOf = new Date().toISOString()

    // the tracked archive: today's rows replaced by this refresh, everything older kept
    let arch = { rows: [] }
    archiveBroken = null
    try { if (fs.existsSync(file(ARCHIVE))) arch = JSON.parse(fs.readFileSync(file(ARCHIVE), 'utf8')); if (!Array.isArray(arch.rows)) throw new Error('no rows array') }
    catch (e) { archiveBroken = e.message; arch = { rows: [] }; console.warn(`${ARCHIVE}: ${e.message} — not updated`) }
    const d = asOf.slice(0, 10)
    const today = Object.entries(byGpu).filter(([g]) => KEEP_SF.has(g)).map(([gpu, x]) => ({ d, gpu, rows: x.rows, available: x.available, share: x.share, listMin: x.listMin, listMedian: x.listMedian, availMin: x.availMin }))
    let rows = arch.rows
    if (!archiveBroken) {
      rows = [...rows.filter(r => r.d !== d), ...today].sort((a, b) => a.d.localeCompare(b.d) || byRank(a.gpu, b.gpu))
      const source = 'Shadeform instance types (api.shadeform.ai/v1/instances/types), on-demand rows only. One row per UTC day per GPU model, from the last refresh of the day: rows = instance-type × region rows, available = rows launchable at that moment, share = available / rows, listMin / listMedian = list price per GPU-hour (USD) over listings, availMin = cheapest per-GPU price among listings available at that moment.'
      try { writeAtomic(ARCHIVE, `{"source":${JSON.stringify(source)},"rows":[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`) }
      catch (e) { archiveBroken = `save failed: ${e.message}`; console.error(`${ARCHIVE} save:`, e.message) }
    }
    const since = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10)
    return {
      asOf, clouds: [...new Set(listings.map(l => l.cloud))].length, listings: listings.length, byGpu,
      history: rows.filter(r => r.d >= since),
      source: 'Shadeform (shadeform.ai) instance types across its partner clouds: list prices and per-region launch availability, on-demand',
    }
  }

  // ── GetDeploying: 53 weeks of list prices by billing type ──
  async function buildGetDeploying() {
    const raw = parseCsv(await fetchText(GD_URL, { accept: 'text/csv, */*;q=0.8', timeout: 60_000 }))
    if (raw.length < 1000 || !('median_price' in raw[0]) || !('billing_type' in raw[0])) throw new Error(`GetDeploying: unexpected file (${raw.length} rows${raw[0] ? `, columns ${Object.keys(raw[0]).join(',')}` : ''})`)
    const map = new Map()
    for (const r of raw) {
      const gpu = gdGpu(r.gpu_slug)
      if (!KEEP_GD.has(gpu) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue
      const kind = gdKind(r.billing_type, r.reservation_months)
      const row = { week: r.date, gpu, kind, min: r3(+r.min_price), median: r3(+r.median_price), max: r3(+r.max_price), pMedian: r3(+r.provider_median_price), n: +r.provider_count || 0, offers: +r.offering_count || 0 }
      if (!fin(row.median)) continue
      const key = `${gpu}|${kind}|${row.week}`
      // RESERVATION_12_MONTH and RESERVATION|12 can describe the same week: the plain RESERVATION row wins
      if (!map.has(key) || String(r.billing_type).toUpperCase() === 'RESERVATION') map.set(key, row)
    }
    const weekly = [...map.values()].sort((a, b) => a.week.localeCompare(b.week) || byRank(a.gpu, b.gpu) || kindRank(a.kind) - kindRank(b.kind))
    if (!weekly.length) throw new Error('GetDeploying: none of the tracked GPU models in the file')
    const gpus = [...new Set(weekly.map(r => r.gpu))].sort(byRank)
    const kinds = [...new Set(weekly.map(r => r.kind))].sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b))
    const latest = weekly.at(-1).week
    const termStructure = {}, yoy = {}
    for (const g of gpus) {
      const rows = weekly.filter(r => r.gpu === g)
      const last = rows.filter(r => r.week === latest)
      const ts = last.filter(r => fin(kindMonths(r.kind))).map(r => ({ months: kindMonths(r.kind), median: r.median, n: r.n })).sort((a, b) => a.months - b.months)
      if (ts.length) termStructure[g] = ts
      const od = rows.filter(r => r.kind === 'on-demand')
      const now = od.find(r => r.week === latest)
      if (!now) continue
      const target = Date.parse(latest) - 364 * DAY
      const ago = od.filter(r => Math.abs(Date.parse(r.week) - target) <= 14 * DAY).sort((a, b) => Math.abs(Date.parse(a.week) - target) - Math.abs(Date.parse(b.week) - target))[0]
      const chg = (a, b) => (fin(a) && fin(b) && b > 0 ? r3((a / b - 1) * 100) : null)
      if (ago) yoy[g] = { kind: 'on-demand', now: now.median, yearAgo: ago.median, chg: chg(now.median, ago.median), yearAgoWeek: ago.week, nNow: now.n, nYearAgo: ago.n }
      else { const first = od[0]; yoy[g] = { kind: 'on-demand', now: now.median, yearAgo: null, chg: null, firstWeek: first.week, first: first.median, chgSinceFirst: first.week < latest ? chg(now.median, first.median) : null, nNow: now.n } }
    }
    return {
      asOf: latest, latestPartial: Date.parse(latest) + 7 * DAY > Date.now(), fetched: new Date().toISOString(),
      attribution: ATTRIB_GD, license: 'https://creativecommons.org/licenses/by/4.0/', url: 'https://getdeploying.com/dataset/gpu-prices',
      gpus, kinds, weeks: [...new Set(weekly.map(r => r.week))].length, weekly, termStructure, yoy,
      source: 'GetDeploying GPU rental price history: weekly min / median / max of advertised list prices per GPU-hour across cloud providers, by billing type (median of the week\'s daily captures)',
    }
  }

  // ── AmCompute: used-GPU resale index + the used-H100 headline ──
  async function buildResale() {
    const csv = await fetchText(AM_CSV, { accept: 'text/csv, */*;q=0.8' })
    const series = parseCsv(csv).filter(r => /^\d{4}-\d{2}$/.test(r.month) && fin(+r.index) && r.index !== '')
      .map(r => ({ month: r.month, index: +r.index, vsBaseline: r.vs_baseline_pct === '' || !fin(+r.vs_baseline_pct) ? null : +r.vs_baseline_pct }))
      .sort((a, b) => a.month.localeCompare(b.month))
    if (series.length < 3) throw new Error(`AmCompute: ${series.length} months in data.csv`)
    const comment = String(csv).split(/\r?\n/).find(l => l.startsWith('#')) || ''
    const updated = comment.match(/updated (\d{4}-\d{2}-\d{2})/)?.[1] || null
    const report = comment.match(/from the (\w+ \d{4}) Rack Report/i)?.[1] || null
    const base = comment.match(/(H\d \d{4}|\d{4}(?:-\d{2})?) = 100/)?.[0] || 'H1 2025 = 100'
    let headline = null, headlineError = null
    try {
      const t = stripHtml(await fetchText(AM_H100, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' }))
      const node = t.match(/Used HGX H100 8x80GB node \$([\d,]+)\s+\$([\d,]+) per GPU/i)
      const sxm = t.match(/Used H100 SXM 80GB, typical realized sale \$([\d,]+)\s+25th percentile \$([\d,]+); dealer ask \$([\d,]+)/i)
      const prose = t.match(/HGX H100 node was worth \$([\d,]+) and a single H100 SXM \$([\d,]+) in the (\w+ \d{4}) Rack Report/i)
      const through = t.match(/(\w+ \d{4}) Rack Report, data through (\w+ \d{4})/i)
      const usedH100Sxm = money(sxm?.[1] ?? prose?.[2]), hgxNode = money(node?.[1] ?? prose?.[1])
      if (fin(usedH100Sxm) || fin(hgxNode)) {
        headline = {
          usedH100Sxm: fin(usedH100Sxm) ? usedH100Sxm : null, usedH100SxmP25: money(sxm?.[2]), dealerAsk: money(sxm?.[3]),
          hgxNode: fin(hgxNode) ? hgxNode : null, hgxPerGpu: money(node?.[2]),
          asOf: ym(through?.[2]) || ym(through?.[1] ?? prose?.[3]), report: through?.[1] ?? prose?.[3] ?? null, url: AM_H100,
        }
      } else headlineError = 'H100 appraisal page: headline figures not found (page layout changed?)'
    } catch (e) { headlineError = `H100 appraisal page: ${e.message}` }
    return {
      attribution: ATTRIB_AM, url: 'https://www.amcompute.com/gpu-resale-index', series, base, updated, report, headline, headlineError,
      source: 'American Compute GPU Resale Index (monthly, Rack Report): used data center GPUs as a share of their price new; vsBaseline = % vs normal depreciation for the same model and age',
    }
  }

  const BUILD = { shadeform: buildShadeform, getdeploying: buildGetDeploying, resale: buildResale }
  const age = k => (parts?.[k] ? Date.now() - Date.parse(parts[k].fetched) : Infinity)
  function refresh(k) {
    const s = state[k]
    if (s.inflight) return s.inflight
    s.inflight = (async () => {
      try { const data = await BUILD[k](); parts[k] = { data, fetched: new Date().toISOString() }; s.error = null; s.errorAt = null; saveCache() }
      catch (e) { s.error = e.message; s.errorAt = Date.now(); console.warn(`gpu-market-data ${k}:`, e.message) }
      finally { s.inflight = null }
    })()
    return s.inflight
  }

  async function get() {
    loadCache()
    const keys = Object.keys(BUILD)
    const due = k => age(k) > TTL[k] && !(state[k].errorAt && Date.now() - state[k].errorAt < RETRY_AFTER)
    // nothing on disk for a source: wait for it (all of them at once); otherwise refresh in the background
    const waits = keys.filter(k => !parts[k] && due(k)).map(refresh)
    if (waits.length) await Promise.all(waits)
    for (const k of keys) if (parts[k] && due(k)) refresh(k)
    if (keys.every(k => !parts[k])) throw new Error(`GPU market data unavailable: ${keys.map(k => `${k}: ${state[k].error || 'no data'}`).join('; ')}`)

    const sourceErrors = []
    for (const k of keys) {
      const err = state[k].error
      if (err) sourceErrors.push({ source: NAMES[k], error: parts[k] ? `${err} (serving data fetched ${parts[k].fetched})` : err })
    }
    if (archiveBroken) sourceErrors.push({ source: ARCHIVE.replace(/\\/g, '/'), error: `could not be read or written (${archiveBroken}); the daily availability archive is not updated until it is fixed` })
    if (parts.resale?.data?.headlineError) sourceErrors.push({ source: 'AmCompute H100 appraisal page', error: parts.resale.data.headlineError })
    const { headlineError, ...resale } = parts.resale?.data || {}
    const fetched = keys.map(k => parts[k]?.fetched).filter(Boolean).sort()
    return {
      built: fetched.at(-1) || null,
      stale: keys.some(k => parts[k] && age(k) > TTL[k]),
      refreshing: keys.some(k => !!state[k].inflight),
      sourceErrors,
      shadeform: parts.shadeform?.data || null,
      getdeploying: parts.getdeploying?.data || null,
      resale: parts.resale ? { ...resale, fetched: parts.resale.fetched } : null,
      fetched: Object.fromEntries(keys.map(k => [k, parts[k]?.fetched || null])),
      note: 'Three independent reads of the GPU market. Shadeform: share of instance-type × region rows launchable right now across ~18 clouds (scarcity; refreshed every 2 hours) and their list prices per GPU-hour; availMin is the cheapest listing that can actually be launched. GetDeploying: advertised list prices per GPU-hour across ~40 providers per model, weekly for a year, by on-demand / spot / reservation term (latest week partial until Sunday). AmCompute: what used data center GPUs sell for, monthly, H1 2025 = 100, plus the used-H100 board and HGX node prices from the Rack Report. List prices are asks, not trades.',
    }
  }

  return { get }
}
