// ============================================================================
// HOUSEHOLD WEALTH — the Survey of Consumer Finances, made usable.
//
// The SCF itself runs every three years and 2022 is still the latest published
// wave, so on its own it cannot drive a live panel. The Fed solves this with the
// Distributional Financial Accounts: SCF microdata benchmarked to the quarterly
// Z.1 Financial Accounts, which carries the same wealth distribution forward to
// the current quarter. That is what this feed is built on.
//
//   DFA     one zip, 26 CSVs. The -detail files add the two things the FRED
//           relays of these series leave out: household counts, so net worth can
//           be stated per household rather than as an aggregate, and the minimum
//           wealth cutoff — what it actually takes to enter each group. The
//           cutoff comes from the survey, so it exists only in survey quarters;
//           2022:Q3 is the most recent.
//   SCF     Table 4 of the 2022 tables, for the one thing the DFA cannot give:
//           medians. The DFA is built from aggregates, so everything derived
//           from it is a mean, and for wealth the mean is roughly five times the
//           median. Showing both is the point, not a redundancy.
//
// A published SCF wave never changes, so it is fetched once and kept. The DFA
// is refreshed weekly — it only moves quarterly, with the Z.1.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { unzipEntries } from './realEstateFeeds.js'

const H = 3600e3, TTL = 7 * 24 * H
const DFA_ZIP = 'https://www.federalreserve.gov/releases/z1/dataviz/download/zips/dfa.zip'
const SCF_XLSX = 'https://www.federalreserve.gov/econres/files/scf2022_tables_public_real_historical.xlsx'

const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null)
const r2 = v => (fin(v) ? +v.toFixed(2) : null)
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null }
// the SCF workbook carries en dashes that survive as replacement chars in some
// readers; normalise rather than print a black diamond in a range label
const clean = s => String(s ?? '').replace(/�/g, '–').replace(/\s+/g, ' ').trim()

// DFA levels are millions of dollars; counts are households.
const MIL = 1e6

const WEALTH_GROUPS = [
  { key: 'TopPt1', label: 'Top 0.1%', blurb: 'the richest one in a thousand households' },
  { key: 'RemainingTop1', label: 'Next 0.9%', blurb: 'the rest of the top 1%' },
  { key: 'Next9', label: 'Next 9%', blurb: '90th to 99th percentile — the professional class' },
  { key: 'Next40', label: 'Next 40%', blurb: '50th to 90th — the middle class, such as it is' },
  { key: 'Bottom50', label: 'Bottom 50%', blurb: 'half of all American households' },
]

// birth years are the Fed's own, from the DFA documentation page
const GEN_GROUPS = [
  { key: 'Silent', label: 'Silent & earlier', blurb: 'born before 1946' },
  { key: 'BabyBoom', label: 'Baby Boomers', blurb: 'born 1946–1964' },
  { key: 'GenX', label: 'Gen X', blurb: 'born 1965–1980' },
  { key: 'Millennial', label: 'Millennials', blurb: 'born 1981 or later — the DFA has no separate Gen Z group' },
]

// asset and liability lines worth carrying, in the order they stack
const COMP = [
  ['realEstate', 'Real estate'],
  ['business', 'Unincorporated businesses'],
  ['equities', 'Corporate equities and mutual fund shares'],
  ['dcPension', 'DC pension entitlements'],
  ['dbPension', 'DB pension entitlements'],
  ['durables', 'Consumer durables'],
  ['other', 'Other assets'],
]
const DEBT = [
  ['mortgage', 'Home mortgages'],
  ['consumerCredit', 'Consumer credit'],
  ['otherDebt', 'Other liabilities'],
]

function csvRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const head = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(l => {
    const cells = l.split(',')
    const o = {}
    head.forEach((h, i) => { o[h] = cells[i] })
    return o
  })
}

// "2026:Q2" sorts correctly as a string, and reads correctly as a label
const qKey = d => d
const qNum = d => { const m = /^(\d{4}):Q(\d)$/.exec(d); return m ? +m[1] * 4 + (+m[2] - 1) : -1 }

function buildCut(groups, levels, detail, shares) {
  const byDate = {}
  const index = rows => {
    const m = new Map()
    for (const r of rows) m.set(`${r.Date}|${r.Category}`, r)
    return m
  }
  const L = index(levels), D = index(detail), S = index(shares)
  const dates = [...new Set(levels.map(r => r.Date))].sort((a, b) => qNum(a) - qNum(b))
  const asOf = dates[dates.length - 1]

  // the cutoff only exists in survey quarters, so find the latest that has one
  let cutoffAsOf = null
  for (let i = dates.length - 1; i >= 0; i--) {
    if (groups.some(g => fin(num(D.get(`${dates[i]}|${g.key}`)?.['Minimum Wealth Cutoff'])))) { cutoffAsOf = dates[i]; break }
  }

  const at = (d, key) => {
    const l = L.get(`${d}|${key}`), dt = D.get(`${d}|${key}`), s = S.get(`${d}|${key}`)
    if (!l) return null
    const nw = num(l['Net worth'])
    const hh = dt ? num(dt['Household count']) : null
    return {
      netWorth: nw, households: hh,
      perHousehold: fin(nw) && fin(hh) && hh > 0 ? (nw * MIL) / hh : null,
      share: s ? num(s['Net worth']) : null,
    }
  }

  const out = groups.map(g => {
    const now = at(asOf, g.key)
    const d5 = dates[dates.length - 21] || dates[0]      // twenty quarters back
    const then = at(d5, g.key)
    const first = at(dates[0], g.key)
    const l = L.get(`${asOf}|${g.key}`) || {}
    const dt = D.get(`${cutoffAsOf}|${g.key}`) || {}
    const assets = num(l.Assets), liabilities = num(l.Liabilities)
    return {
      ...g,
      households: now?.households ?? null,
      netWorth: now?.netWorth ?? null,
      perHousehold: now?.perHousehold ?? null,
      share: r2(now?.share),
      shareThen: r2(then?.share),
      perHouseholdThen: then?.perHousehold ?? null,
      perHousehold1989: first?.perHousehold ?? null,
      cutoff: num(dt['Minimum Wealth Cutoff']),
      assets, liabilities,
      leverage: fin(assets) && assets > 0 && fin(liabilities) ? r1((liabilities / assets) * 100) : null,
      comp: Object.fromEntries(COMP.map(([k, col]) => [k, num(l[col])])),
      debt: Object.fromEntries(DEBT.map(([k, col]) => [k, num(l[col])])),
    }
  })

  // share-of-wealth history, plus per-household history, one row per quarter
  const history = dates.map(d => {
    const row = { d }
    for (const g of groups) {
      const a = at(d, g.key)
      row[g.key] = r2(a?.share)
      row[`${g.key}_ph`] = fin(a?.perHousehold) ? Math.round(a.perHousehold) : null
    }
    return row
  })

  return { asOf, cutoffAsOf, groups: out, history, since: dates[0] }
}

// ── SCF Table 4: median and mean net worth by family characteristic ──
function parseScf(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets['Table 4']
  if (!ws) throw new Error('SCF: sheet "Table 4" not found')
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  // row 3 carries the survey years; each year owns a median column then a mean
  const yearRow = g.find(r => r && String(r[0] || '').toLowerCase().startsWith('family characteristic')) || g[2]
  const waves = []
  for (let c = 1; c < 40; c++) {
    const v = yearRow?.[c]
    const y = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
    if (Number.isInteger(y) && y >= 1989 && y <= 2100) waves.push(y)
  }
  if (!waves.length) throw new Error('SCF: no survey years in the header row')
  // columns run median, mean, median, mean … starting at index 1
  const med = i => 1 + 2 * i, mean = i => 2 + 2 * i
  const pair = (row, i) => {
    const a = row?.[med(i)], b = row?.[mean(i)]
    return { median: typeof a === 'number' ? a : null, mean: typeof b === 'number' ? b : null }
  }

  const rowsOut = [], sections = []
  let current = null, allFamilies = null, allHistory = []
  for (const row of g) {
    if (!row) continue
    const labelRaw = row[0]
    if (typeof labelRaw !== 'string') continue
    const lab = clean(labelRaw)
    // the title, the units line and the two header rows are not data
    if (!lab || /^\d+(\.\d+)?$/.test(lab)) continue
    if (/^NOTE:|^– Less than|^4\.\s|^thousands of|^family characteristic$/i.test(lab)) continue
    const last = pair(row, waves.length - 1)
    const hasNumbers = fin(last.median) || fin(last.mean)
    if (/^all families$/i.test(lab)) {
      allFamilies = last
      allHistory = waves.map((y, i) => ({ year: y, ...pair(row, i) }))
      continue
    }
    if (!hasNumbers) { current = { name: lab, rows: [] }; sections.push(current); continue }
    if (!current) continue
    const r = {
      label: lab, ...last,
      ratio: fin(last.median) && last.median > 0 && fin(last.mean) ? r1(last.mean / last.median) : null,
      history: waves.map((y, i) => ({ year: y, ...pair(row, i) })),
    }
    current.rows.push(r)
    rowsOut.push(r)
  }
  return {
    year: waves[waves.length - 1], waves,
    unit: `thousands of ${waves[waves.length - 1]} dollars`,
    all: allFamilies, allHistory,
    sections: sections.filter(s => s.rows.length),
  }
}

export function createHouseholdWealth({ UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }

  let mem = null, inflight = null
  // a published SCF wave is final, so keep it once parsed
  let scfArchive = load('scf-archive.json')

  const grab = async url => {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('/').pop()}`)
    return Buffer.from(await r.arrayBuffer())
  }

  async function build() {
    const t0 = Date.now()
    const zip = await grab(DFA_ZIP)
    const entries = unzipEntries(zip)
    const text = n => {
      const e = entries.find(x => x.name === n)
      if (!e?.data) throw new Error(`DFA zip: ${n} missing`)
      return e.data.toString('utf8')
    }
    const cut = (stem, groups) => buildCut(
      groups,
      csvRows(text(`dfa-${stem}-levels.csv`)),
      csvRows(text(`dfa-${stem}-levels-detail.csv`)),
      csvRows(text(`dfa-${stem}-shares.csv`)),
    )
    const wealth = cut('networth', WEALTH_GROUPS)
    const generation = cut('generation', GEN_GROUPS)

    if (!scfArchive) {
      try { scfArchive = parseScf(await grab(SCF_XLSX)); save('scf-archive.json', scfArchive) }
      catch (e) { console.error('SCF tables:', e.message) }
    }

    return {
      built: new Date().toISOString(),
      tookMs: Date.now() - t0,
      source: { dfa: DFA_ZIP, scf: SCF_XLSX },
      asOf: wealth.asOf,
      cuts: { wealth, generation },
      scf: scfArchive || null,
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const data = await build()
        mem = { ts: Date.now(), data }
        save('household-wealth.json', mem)
        return data
      } catch (e) {
        const disk = load('household-wealth.json')
        if (disk?.data) { mem = disk; console.error('household wealth: serving cache —', e.message); return disk.data }
        throw e
      } finally { inflight = null }
    })()
    return inflight
  }

  const disk = load('household-wealth.json')
  if (disk?.data) mem = disk

  return { get }
}
