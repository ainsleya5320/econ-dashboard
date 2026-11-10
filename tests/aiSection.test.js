import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePage, derive, shift, monthKey } from '../server/taiwanRevenue.js'
import { curveAt, readIssuer, matched } from '../server/aiCredit.js'
import { buildFlows } from '../server/aiFlows.js'

// ── Taiwan monthly revenue ───────────────────────────────────────────────────
test('reads company rows off a monthly revenue page and skips headers, totals and blanks', () => {
  const html = `<table><tr><th>公司代號</th><th>公司名稱</th><th>當月營收</th></tr>
    <tr><td>1111</td><td>Alpha</td><td>1,234,567</td><td>1,000,000</td><td>900,000</td><td>23.46</td><td>37.17</td><td>9</td><td>8</td></tr>
    <tr><td>2222</td><td>Beta</td><td>&nbsp;</td><td>5</td><td>5</td><td>0</td><td>0</td><td>1</td><td>1</td></tr>
    <tr><td>合計</td><td></td><td>9,999</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></table>`
  assert.deepEqual(parsePage(html), { 1111: 1234567 })
})

test('steps months across a year end', () => {
  assert.equal(shift('2026-01', -1), '2025-12')
  assert.equal(shift('2025-11', 3), '2026-02')
  assert.equal(monthKey(2026, 3), '2026-03')
})

test('derives growth per company and per link, leaving mixed companies and unreported months out of a link', () => {
  const universe = { groups: [{ id: 'g', label: 'Link' }], companies: [{ code: 'A', name: 'A Co', group: 'g' }, { code: 'B', name: 'B Co', group: 'g' }, { code: 'M', name: 'Mixed Co', group: 'g', mixed: true }] }
  const months = {}
  // A doubles on the year, B is flat, M is huge and falling; B has not reported the newest month
  for (let i = 0; i < 16; i++) { const m = shift('2025-01', i), late = i >= 12; months[m] = { A: late ? 200 : 100, B: 50, M: late ? 5000 : 9000 } }
  delete months['2026-04'].B
  const d = derive(months, universe)
  assert.equal(d.asOf, '2026-04')
  assert.deepEqual(d.pending, ['B Co'])
  const a = d.companies.find(c => c.code === 'A'), b = d.companies.find(c => c.code === 'B')
  assert.deepEqual([a.latest.m, a.latest.yoy, a.latest.yoy3, a.latest.mom, a.ytdYoy], ['2026-04', 1, 1, 0, 1])
  assert.equal(b.reported, false)
  assert.equal(b.latest.m, '2026-03')   // a late filer shows its own newest month
  const g = d.groups[0]
  assert.equal(g.members, 2)            // the mixed company is not in the link's total
  assert.equal(g.latest.m, '2026-03')   // April waits for B
  assert.equal(g.latest.rev, 250)
  assert.equal(g.latest.yoy, 0.6667)    // (200 + 50) / (100 + 50) − 1
})

// ── AI credit basket ─────────────────────────────────────────────────────────
const line = [{ years: 1, yield: 4 }, { years: 5, yield: 5 }, { years: 30, yield: 6 }]

test('interpolates the Treasury curve and holds its ends', () => {
  assert.equal(curveAt(line, 3), 4.5)
  assert.equal(curveAt(line, 0.2), 4)
  assert.equal(curveAt(line, 50), 6)
  assert.equal(curveAt(null, 3), null)
})

test('reads an issuer from plain bonds only, and lists convertibles by price', () => {
  const bonds = [
    { cusip: 'P1', coupon: 5, maturity: '2031-11-09', cv: false, price: 99, yield: 6, last: '2026-11-06' },
    { cusip: 'P2', coupon: 6, maturity: '2036-11-09', cv: false, price: 98, yield: 7, last: '2026-11-09' },
    { cusip: 'SHORT', coupon: 5, maturity: '2027-03-01', cv: false, price: 100, yield: 9, last: '2026-11-09' },   // under a year left
    { cusip: 'STALE', coupon: 5, maturity: '2032-01-01', cv: false, price: 90, yield: 12, last: '2026-09-01' },   // has not traded in two weeks
    { cusip: 'CV', coupon: 0, maturity: '2031-01-01', cv: true, price: 120, yield: null, last: '2026-11-09' },
  ]
  const { reading, bonds: kept } = readIssuer(bonds, '2026-11-09', line)
  assert.deepEqual(kept.map(b => b.cusip), ['P1', 'P2'])
  assert.equal(reading.n, 2)
  assert.equal(reading.y, 6.5)
  assert.equal(reading.s, 1.4)          // (6 − 5.00) and (7 − 5.20), median
  assert.deepEqual([reading.lo, reading.hi], [1, 1.8])
  assert.deepEqual([reading.cn, reading.cp], [1, 120])
  // without a curve the yields still read, the spread does not
  assert.equal(readIssuer(bonds, '2026-11-09', null).reading.s, null)
})

test('measures change over the bonds present on both days', () => {
  const was = { b: { P1: [6, 1], P2: [7, 2] }, c: { CV: 110 } }
  const now = { b: { P1: [6.5, 1.25], P3: [20, 15] }, c: { CV: 104, CV2: 50 } }   // P3 and CV2 are new: they must not move the figure
  assert.deepEqual(matched(now, was), { dYield: 50, dSpread: 25, dPrice: -6, bonds: 1 })
  assert.deepEqual(matched(now, null), { dYield: null, dSpread: null, dPrice: null, bonds: 0 })
})

// ── Compute flows ────────────────────────────────────────────────────────────
test('totals firm and soft commitments and sets the labs beside a supplier\'s backlog', () => {
  const flows = {
    nodes: [{ id: 'lab', label: 'Lab', tier: 'lab' }, { id: 'buyer', label: 'Buyer', tier: 'platform' }, { id: 'cloud', label: 'Cloud', tier: 'neocloud', backlog: 'CLD' }],
    sources: { s: { title: 'Filing', url: 'https://example.com/f' } },
    edges: [
      { from: 'lab', to: 'cloud', amount: 30, basis: 'filed', checked: true, source: 's' },
      { from: 'buyer', to: 'cloud', amount: 20, basis: 'announced', checked: false, source: 's' },
      { from: 'lab', to: 'cloud', amount: 50, upTo: true, firm: false, basis: 'filed', checked: true, source: 's' },
      { from: 'lab', to: 'nobody', amount: 5 },                  // unknown company: dropped
    ],
  }
  const backlog = { tickers: { CLD: { series: [{ label: 'RPO', points: [{ end: '2026-03-31', value: 80 }, { end: '2026-06-30', value: 100 }, { end: '2026-09-30', value: null }] }] } } }
  const out = buildFlows(flows, backlog)
  assert.equal(out.edges.length, 3)
  assert.deepEqual(out.totals, { firm: 50, soft: 50, checked: 2, edges: 3 })
  assert.equal(out.edges[0].source.title, 'Filing')
  const lab = out.nodes.find(n => n.id === 'lab'), cloud = out.nodes.find(n => n.id === 'cloud')
  assert.deepEqual([lab.out, lab.outFirm], [80, 30])
  assert.deepEqual([cloud.in, cloud.inFirm, cloud.fromLabs], [100, 50, 30])
  const s = out.suppliers[0]
  assert.deepEqual([s.backlog, s.backlogAsOf, s.fromLabs, s.labCeiling, s.named], [100, '2026-06-30', 30, 0.3, 50])   // the newest reported point, not the blank one
})
