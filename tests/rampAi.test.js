import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unescapePayload, arrayAt, figure, tableRows, parsePage, shape, tokens } from '../server/rampAi.js'

// a miniature of Ramp's page: a server-rendered payload with escaped quotes, "$undefined" for missing values,
// $$ for a dollar sign, and the token growth written only in prose
const months = ['2025-09-01', '2025-10-01', ...Array.from({ length: 12 }, (_, k) => `2026-${String(k + 1).padStart(2, '0')}-01`)].slice(0, 14)
const esc = o => JSON.stringify(o).replace(/"/g, '\\"')
const td = v => `["$","td",null,{"className":"border-r px-3 [&_ul]:mb-0","children":"${v}"}]`
const page = 'self.__next_f.push([1,"' + [
  `"adoptionOverall":${esc(months.map((d, k) => ({ date_month: d, adoption_rate_pct: 40 + k })))}`,
  `"adoptionVendor":${esc(months.flatMap((d, k) => [{ date_month: d, vendor: 'Anthropic', adoption_rate_pct: 15 + 2 * k }, { date_month: d, vendor: 'OpenAI', adoption_rate_pct: 40 }]))}`,
  `"adoptionIndustry":${esc(months.map((d, k) => ({ date_month: d, naics_sector: 'Finance & Insurance', adoption_rate_pct: 50 + k })))}`,
  `"adoptionSize":${esc(months.map(d => ({ date_month: d, business_size: '3. Mid-Market (MM)', adoption_rate_pct: 60 })))}`,
  `"spendPerEmployee":${esc(months.map((d, k) => ({ date_month: d, median_pepm: 5 + k, p90_pepm: '$undefined', top_10_percent_median_pepm: 200, top_1_percent_median_pepm: 3000 })))}`,
  `"spendPerEmployeeCurated":${esc(months.map(d => ({ date_month: d, dimension_type: 'naics_sector', dimension_label: 'Finance and Insurance', median_pepm: 20 })))}`,
  `"spendShareData":{"overall":${esc(months.map((d, k) => ({ my_date: d, ai_share_of_tpv: 0.03 + k * 0.001 })))},"sector":${esc(months.map(d => ({ my_date: d, naics_sector: 'Finance and Insurance', ai_share_of_tpv: 0.05 })))}}`,
].join(',') + '"])' +
  `["$","td",null,{"children":"Share of token spend: Anthropic"}],${td('58.7%')},${td('56.9%')}` +
  `["$","td",null,{"children":"Blended price per million tokens: OpenAI & Anthropic"}],${td('$$0.45')},${td('$$0.51')}` +
  `<p>In the week ending November 15, 2026, Anthropic led. Total token spending rose 12.0%. Total token volume rose 27.2%.</p>`

test('figures as Ramp prints them become numbers', () => {
  assert.equal(figure('$$10,199.20'), 10199.2)
  assert.equal(figure('58.7%'), 58.7)
  assert.equal(figure('+12.0%'), 12)
  assert.equal(figure('−3.1%'), -3.1)
  assert.equal(figure(null), null)
})

test('reads a series out of the escaped payload, turning "$undefined" into null', () => {
  const s = unescapePayload(page)
  const a = arrayAt(s, 'spendPerEmployee')
  assert.equal(a.length, 14)
  assert.equal(a[0].p90_pepm, null)
  assert.equal(arrayAt(s, 'nothingHere'), null)
})

test('the summary tables and the prose give the token week', () => {
  const p = parsePage(page)
  const t = tokens(p.table, p.week)
  assert.equal(t.week, 'November 15, 2026')
  assert.deepEqual(t.spendShare, [{ name: 'Anthropic', latest: 58.7, prior: 56.9 }])
  assert.deepEqual(t.price, [{ name: 'OpenAI & Anthropic', latest: 0.45, prior: 0.51 }])
  assert.equal(t.spendGrowth, 12)
  assert.equal(t.volumeGrowth, 27.2)
  assert.ok(Object.keys(tableRows(unescapePayload(page))).length >= 2)
})

test('shapes monthly lines, a year-on-year change, and joins industries named two ways', () => {
  const s = shape(parsePage(page))
  assert.equal(s.asOf, months.at(-1).slice(0, 7))
  assert.equal(s.yearAgo, months.at(-13).slice(0, 7))
  const last = s.series.at(-1)
  assert.deepEqual([last.overall, last.Anthropic, last.OpenAI, last.median], [53, 41, 40, 18])
  assert.equal(last.share, 4.3)
  assert.deepEqual(s.vendors, ['Anthropic', 'OpenAI'])
  const fin = s.byIndustry[0]
  assert.equal(fin.name, 'Finance & Insurance')
  assert.equal(fin.change, 12)
  assert.equal(fin.spendShare, 5)                         // "Finance and Insurance" in the spend series
  assert.equal(fin.pepm, 20)
  assert.equal(s.bySize[0].name, 'Mid-Market')
})

test('a page without the series is reported as unreadable rather than half-read', () => {
  assert.equal(parsePage('<html>nothing</html>'), null)
})
