// ============================================================================
// DAMODARAN IMPLIED ERP — the monthly update
// Aswath Damodaran refreshes his implied equity risk premium at the start of
// every month in ERPbymonth.xlsx (start-of-month S&P level, T-bond rate,
// trailing cash flows, expected growth, ERP two ways). The dashboard's annual
// series (src/lib/damodaran.json, 1960→) stays for the long-run percentile;
// this feed supplies the current month. The workbook is read without a
// library: xlsx is a zip, the sheet is XML, and the file uses Excel's 1904
// date system (it is built on a Mac), which is detected from workbook.xml.
// Fallback: the one-line summary on his home page. Cached 24h on disk.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { unzipEntries } from './realEstateFeeds.js'

const TTL = 24 * 60 * 60 * 1000
const XLSX = 'https://pages.stern.nyu.edu/~adamodar/pc/implprem/ERPbymonth.xlsx'
const HOME = 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm'
const fin = v => v != null && Number.isFinite(v)
const serialToDate = (n, d1904) => new Date(Date.UTC(d1904 ? 1904 : 1899, 0, d1904 ? 1 : 30) + Math.round(n) * 864e5).toISOString().slice(0, 10)
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 }

function parseWorkbook(buf) {
  const entries = unzipEntries(buf)
  const text = name => entries.find(e => e.name === name)?.data?.toString('utf8') || ''
  const d1904 = /date1904="(1|true)"/i.test(text('xl/workbook.xml'))
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(m => m[1].replace(/<[^>]+>/g, ''))
  const sheet = text('xl/worksheets/sheet1.xml')
  const rows = []
  for (const rm of sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells = {}
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/gs)) {
      const v = cm[3].match(/<v>(.*?)<\/v>/)?.[1]
      if (v == null) continue
      cells[cm[1]] = /t="s"/.test(cm[2]) ? shared[+v] : parseFloat(v)
    }
    rows.push(cells)
  }
  // header row tells us which column is which; the file's layout has drifted over the years
  const head = rows.find(r => typeof r.A === 'string' && /start of month/i.test(r.A)) || {}
  const col = re => Object.keys(head).find(k => re.test(String(head[k]))) || null
  const cERP = col(/ERP \(T12 ?m with sustainable payout\)/i) || col(/ERP \(T12 ?m\)/i) || 'I'
  const cCash = col(/ERP \(T12 ?m\)$/i) || 'J', cBond = col(/T\.? ?Bond Rate/i) || 'C', cSp = col(/S&(amp;)?P 500/i) || 'B', cGrowth = col(/expected growth/i) || 'H'
  const series = rows.filter(r => fin(r.A) && r.A > 30000 && fin(r[cERP])).map(r => ({ d: serialToDate(r.A, d1904), erp: r[cERP], erpCash: fin(r[cCash]) ? r[cCash] : null, tbond: fin(r[cBond]) ? r[cBond] : null, sp: fin(r[cSp]) ? r[cSp] : null, growth: fin(r[cGrowth]) ? r[cGrowth] : null }))
  return { series, d1904 }
}

async function parseHomePage(UA) {
  const r = await fetch(HOME, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`home page HTTP ${r.status}`)
  const t = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const m = t.match(/Implied ERP on ([A-Z][a-z]+) (\d{1,2}), (\d{4}) = (\d+)\.\s?(\d+)%/)
  if (!m) throw new Error('home page: ERP sentence not found')
  const tb = t.match(/treasury rate of (\d+\.\d+)%/i)
  const cash = t.match(/(\d+\.\d+)% \(Trailing 12 month cash yield\)/i)
  return { d: `${m[3]}-${String(MONTHS[m[1]] || 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`, erp: parseFloat(`${m[4]}.${m[5]}`) / 100, erpCash: cash ? parseFloat(cash[1]) / 100 : null, tbond: tb ? parseFloat(tb[1]) / 100 : null, sp: null, growth: null }
}

export function createDamodaranErp({ UA, dir }) {
  const FILE = path.join(dir, 'damodaran-monthly.json')
  let mem = null, inflight = null
  const load = () => { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {} return null }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('damodaran-monthly save:', e.message) } }

  async function build() {
    let series = [], method = 'ERPbymonth.xlsx'
    try {
      const r = await fetch(XLSX, { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`xlsx HTTP ${r.status}`)
      series = parseWorkbook(Buffer.from(await r.arrayBuffer())).series
      if (series.length < 24) throw new Error(`only ${series.length} monthly rows parsed`)
      // sanity: the latest print must be within ~2 months of today, or the date system guess is wrong
      const age = (Date.now() - Date.parse(series[series.length - 1].d)) / 864e5
      if (age > 70 || age < -10) throw new Error(`latest row dated ${series[series.length - 1].d}`)
    } catch (e) {
      console.warn('Damodaran monthly xlsx:', e.message, '— falling back to the home page')
      series = [await parseHomePage(UA)]; method = 'home page'
    }
    const cur = series[series.length - 1], yrAgo = series.length > 12 ? series[series.length - 13] : null
    const vals = series.map(p => p.erp)
    return {
      asOf: cur.d, erp: cur.erp, erpCash: cur.erpCash, tbond: cur.tbond, sp500: cur.sp, growth: cur.growth,
      chg1y: yrAgo ? +((cur.erp - yrAgo.erp) * 100).toFixed(2) : null, pctMonthly: series.length > 24 ? Math.round((vals.filter(v => v < cur.erp).length / vals.length) * 100) : null,
      since: series[0].d.slice(0, 4), n: series.length, series: series.map(p => ({ d: p.d, erp: p.erp, tbond: p.tbond })),
      method, source: 'Aswath Damodaran, NYU Stern — implied ERP (trailing 12 months, sustainable payout), updated at the start of each month',
      updated: new Date().toISOString(),
    }
  }
  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load()
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save(mem); return data }
      catch (e) { console.warn('damodaran-monthly:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
