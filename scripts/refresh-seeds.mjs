// ============================================================================
// Refresh the committed seed files in data/seeds/.
//
// Two sources refuse requests from Netlify's build machines (datacenter IPs)
// while answering normally from a home connection:
//   download.bls.gov   the State & Metro series catalog (sm.series, sm.area),
//                      used only to look up which series ids belong to each
//                      metro — the numbers themselves come from api.bls.gov
//   imf.org DataMapper current account, GDP and inflation (WEO), updated each
//                      April and October
// The server modules try the live source first and fall back to these seeds,
// so the Netlify bake always has something.
//
// The Market Map's annual half is a seed by design rather than a fallback:
// Census income, population, housing and permit files plus Realtor.com's
// 2017–19 inventory baseline — ~300 MB of downloads that change once a year
// (server/marketMapSeed.js has the list and the release calendar is in its
// header).
//
// The Historical tab's long-run series (Shiller, Jordà–Schularick–Taylor, the
// Bank of England's millennium dataset, Schmelzing, the Minneapolis Fed CPI)
// are finished history; re-run that section when a new release appears.
//
// Stocks → Sin & Folly is built from SEC XBRL frames and full-text search
// (~4,500 requests, ~15 minutes). The server refreshes the last few years by
// itself each week; re-run the whole thing once a year, after the 10-K season.
//
// Run after each WEO release (April, October), after the Census releases
// (ACS 5-year in December/January, SAIPE in December, population estimates in
// March, permits in May), or when BLS redefines metro series; commit
// data/seeds/ afterwards. All sections by default, or name the ones to run:
//
//   node scripts/refresh-seeds.mjs
//   node scripts/refresh-seeds.mjs market-map
//   node scripts/refresh-seeds.mjs long-run
//   node scripts/refresh-seeds.mjs sin
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { METROS } from '../server/realEstateFeeds.js'
import { selectEmploymentSeries } from '../server/metroEmployment.js'
import { IMF_INDICATORS } from '../server/tradeFlows.js'
import { buildMarketMapSeed, SEED_NAME } from '../server/marketMapSeed.js'
import { buildLongRunSeed, SEED_NAME as LONG_RUN_SEED } from '../server/longRunSeed.js'
import { buildSinMonitor, SEED_NAME as SIN_SEED } from '../server/sinMonitorSeed.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'data', 'seeds')
fs.mkdirSync(out, { recursive: true })
const SECTIONS = ['bls', 'imf', 'market-map', 'long-run', 'sin']
const asked = process.argv.slice(2)
const unknown = asked.filter(a => !SECTIONS.includes(a))
if (unknown.length) { console.error(`unknown section(s): ${unknown.join(', ')} — choose from ${SECTIONS.join(', ')}`); process.exit(1) }
const run = name => !asked.length || asked.includes(name)

const get = async (url, as = 'text') => {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`)
  return as === 'json' ? r.json() : r.text()
}
const write = (name, data) => {
  const file = path.join(out, name)
  fs.writeFileSync(file, JSON.stringify(data))
  console.log(`wrote ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`)
}
const tsv = text => { const lines = text.trim().split(/\r?\n/), h = lines.shift().split('\t').map(s => s.trim()); return lines.map(l => Object.fromEntries(l.split('\t').map((v, i) => [h[i], v.trim()]))) }

// ── BLS metro catalog ──
if (run('bls')) {
  const ROOT = 'https://download.bls.gov/pub/time.series/sm/'
  const [series, areas] = await Promise.all([get(ROOT + 'sm.series'), get(ROOT + 'sm.area')])
  const names = Object.fromEntries(tsv(areas).map(a => [a.area_code, a.area_name]))
  const catalogs = Object.fromEntries(METROS.map(m => [m.code, { ...selectEmploymentSeries(series, m.code), areaName: names[m.code] ?? m.name }]))
  write('bls-employment-catalog.json', { version: 1, catalogs, fetchedAt: new Date().toISOString(), source: 'BLS State and Metro Area Employment (sm.series, sm.area)' })
}

// ── IMF DataMapper ──
if (run('imf')) {
  const DM = 'https://www.imf.org/external/datamapper/api/v1'
  const values = {}
  for (const ind of IMF_INDICATORS) {
    const v = (await get(`${DM}/${ind}`, 'json')).values?.[ind]
    if (!v || Object.keys(v).length < 150) throw new Error(`DataMapper ${ind}: unexpectedly few economies`)
    values[ind] = v
  }
  const countries = Object.fromEntries(Object.entries((await get(`${DM}/countries`, 'json')).countries || {}).map(([k, c]) => [k, { label: c.label }]))
  write('imf-datamapper.json', { values, countries, fetchedAt: new Date().toISOString(), source: 'IMF World Economic Outlook via DataMapper API' })
}

// ── Market Map, annual half ──
if (run('market-map')) {
  const seed = await buildMarketMapSeed()
  const counties = Object.keys(seed.areas).filter(id => /^\d{5}$/.test(id)).length
  if (counties < 3000 || Object.keys(seed.cbsa).length < 900) throw new Error(`market map seed looks short: ${counties} counties, ${Object.keys(seed.cbsa).length} CBSAs`)
  write(SEED_NAME, seed)
}

// ── Historical tab, long run ──
if (run('long-run')) write(LONG_RUN_SEED, await buildLongRunSeed())

// ── Stocks → Sin & Folly ──
// EDGAR wants a user agent; the same one the dev server sends. The earlier
// seed's company records (SIC, 10-K filer) and any full-text series whose
// query is unchanged are reused, so a rebuild is ~3,000 requests, not ~5,000.
if (run('sin')) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  let prior = null
  try { prior = JSON.parse(fs.readFileSync(path.join(out, SIN_SEED), 'utf8')) } catch { /* first build */ }
  const seed = await buildSinMonitor({ UA, prev: prior })
  const years = Object.keys(seed.agg).length
  if (seed.league.length < 450 || years < 10) throw new Error(`sin monitor seed looks short: ${seed.league.length} companies, ${years} years`)
  write(SIN_SEED, seed)
}
