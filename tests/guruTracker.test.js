import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGuruTracker, findCheckout, widelyHeld } from '../server/guruTracker.js'

// A parent folder holding the dashboard and, beside it, a Research Database with a guru summary.
function layout(summary = { period: '2026-06-30', counts: { managers: 2 } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gurus-'))
  const dash = path.join(root, 'econ-dashboard'), db = path.join(root, 'Research-Database')
  fs.mkdirSync(dash)
  fs.mkdirSync(path.join(db, 'data', 'generated'), { recursive: true })
  fs.writeFileSync(path.join(db, 'data', 'generated', 'gurus.json'), JSON.stringify(summary))
  return { root, dash, db }
}

test('finds a Research Database checkout beside the dashboard, or the folder named in .env', () => {
  const { root, dash, db } = layout()
  assert.equal(findCheckout(dash, ''), db)
  assert.equal(findCheckout(dash, db), db)
  assert.equal(findCheckout(dash, path.join(root, 'nowhere')), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('serves the summary with where it came from and the app link, and re-reads it when it changes', async () => {
  const { root, dash, db } = layout()
  const g = createGuruTracker({ dir: dash, env: { RESEARCH_DB_URL: 'http://localhost:5051/app/#gurus' } })
  const a = await g.get()
  assert.equal(a.available, true)
  assert.equal(a.source, 'local')
  assert.equal(a.where, db)
  assert.equal(a.researchUrl, 'http://localhost:5051/app/')
  assert.equal(a.period, '2026-06-30')
  const file = path.join(db, 'data', 'generated', 'gurus.json')
  fs.writeFileSync(file, JSON.stringify({ period: '2026-09-30' }))
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
  assert.equal((await g.get()).period, '2026-09-30')
  fs.rmSync(root, { recursive: true, force: true })
})

test('says how to connect it when there is no checkout and no token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gurus-none-'))
  const saved = { gh: process.env.GITHUB_TOKEN, rt: process.env.RESEARCH_DB_TOKEN, rd: process.env.RESEARCH_DB_DIR }
  delete process.env.GITHUB_TOKEN; delete process.env.RESEARCH_DB_TOKEN; delete process.env.RESEARCH_DB_DIR
  try {
    const r = await createGuruTracker({ dir, env: {} }).get()
    assert.equal(r.available, false)
    assert.match(r.reason, /RESEARCH_DB_DIR/)
    assert.equal(r.researchUrl, 'http://localhost:5050/app/')
  } finally {
    for (const [k, v] of [['GITHUB_TOKEN', saved.gh], ['RESEARCH_DB_TOKEN', saved.rt], ['RESEARCH_DB_DIR', saved.rd]]) if (v !== undefined) process.env[k] = v
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// A checkout with the per-manager file and holdings.json beside the summary.
function fullLayout() {
  const summary = { period: '2026-06-30', counts: { managers: 2, participants: 2 }, styles: { value: { label: 'Concentrated value', reads: 'r' } },
    managers: [{ slug: 'acme', manager: 'A. Person', firm: 'Acme Capital', style: 'value', book: 100, prevBook: 80 }, { slug: 'nofile', firm: 'No File Partners', style: 'value' }] }
  const { root, dash, db } = layout(summary)
  fs.mkdirSync(path.join(db, 'data', 'generated', 'gurus', 'managers'), { recursive: true })
  fs.writeFileSync(path.join(db, 'data', 'generated', 'gurus', 'managers', 'acme.json'), JSON.stringify({
    slug: 'acme', period: '2026-06-30', filer: 'ACME CAPITAL LLC', cik: 1,
    positions: [{ k: 'AAA', w: 0.6, v: 60, sh: 10, act: 'add', chg: 0.2 }, { k: 'BBB', w: 0.4, v: 40, sh: 5, act: 'new', chg: null }, { k: 'CCC', act: 'exit', prevW: 0.1 }],
    options: [{ k: 'AAA', kind: 'put', v: 5, act: 'new' }], history: [{ p: '2026-03-31', book: 80, n: 2 }, { p: '2026-06-30', book: 100, n: 2 }], filings: [] }))
  const tick = (name, holders, extra = {}) => ({ name, type: 'EQUITY', sicDescription: 'Widgets', themes: [], holders, n: holders.length, new: 0, add: 0, trim: 0, exit: 0, buyers: 0, sellers: 0, wsum: holders.reduce((s, h) => s + h.w, 0), wmax: Math.max(...holders.map(h => h.w)), pts: 0, last: 10, basis: null, vsBasis: null, ...extra })
  fs.writeFileSync(path.join(db, 'data', 'generated', 'gurus', 'holdings.json'), JSON.stringify({ period: '2026-06-30', prevPeriod: '2026-03-31', tickers: {
    AAA: tick('Aaa Inc.', [{ m: 'acme', w: 0.6, v: 60, act: 'add' }, { m: 'other', w: 0.1, v: 10, act: 'hold' }], { buyers: 1, add: 1 }),
    BBB: tick('Bbb Corp.', [{ m: 'acme', w: 0.4, v: 40, act: 'new' }], { new: 1, buyers: 1 }),
    ZZZ: tick('Zzz plc', [{ m: 'p', w: 0.05, v: 5, act: 'hold' }, { m: 'q', w: 0.02, v: 2, act: 'hold' }, { m: 'r', w: 0.01, v: 1, act: 'trim' }], { sellers: 1, trim: 1 }),
  } }))
  return { root, dash, db }
}

test('serves one manager with each position named from holdings.json, and says when the file or the manager is missing', async () => {
  const { root, dash } = fullLayout()
  const g = createGuruTracker({ dir: dash, env: {} })
  const m = await g.manager('acme')
  assert.equal(m.available, true)
  assert.equal(m.firm, 'Acme Capital')
  assert.equal(m.styles.value.label, 'Concentrated value')
  assert.deepEqual(m.detail.positions.map(p => [p.k, p.name, p.sic, p.holders]), [['AAA', 'Aaa Inc.', 'Widgets', 2], ['BBB', 'Bbb Corp.', 'Widgets', 1], ['CCC', null, null, null]])
  assert.equal(m.detail.options[0].name, 'Aaa Inc.')
  assert.equal(m.detail.history.length, 2)
  assert.match((await g.manager('nofile')).reason, /no book file for No File Partners/)
  assert.match((await g.manager('nobody')).reason, /No manager "nobody"/)
  assert.match((await g.manager('../etc')).reason, /Which manager/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('ranks the most widely held names by holders, then combined value', async () => {
  const { root, dash } = fullLayout()
  const g = createGuruTracker({ dir: dash, env: {} })
  const h = await g.held()
  assert.equal(h.available, true)
  assert.equal(h.participants, 2)
  assert.deepEqual(h.rows.map(r => [r.k, r.n, r.value]), [['ZZZ', 3, 8], ['AAA', 2, 70], ['BBB', 1, 40]])   // two filers: every holder counts
  const strict = widelyHeld({ tickers: { ZZZ: { name: 'Zzz', holders: [{ m: 'p', w: 0.05, v: 5 }, { m: 'q', w: 0.02, v: 2 }, { m: 'r', w: 0.01, v: 1 }], wsum: 0.08, wmax: 0.05 } } }, { min: 3, limit: 5 })
  assert.equal(strict.length, 1)
  assert.equal(strict[0].avgW.toFixed(4), '0.0267')
  assert.deepEqual(strict[0].top.map(t => t[0]), ['p', 'q', 'r'])
  fs.rmSync(root, { recursive: true, force: true })
})
