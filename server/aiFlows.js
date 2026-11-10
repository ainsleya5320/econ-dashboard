// ============================================================================
// AI COMPUTE FLOWS — AI Economy → Models & Labs: who pays whom. Named,
// dollar-denominated commitments between the labs, the cloud platforms, the
// neoclouds and their hosts, and how much of each supplier's backlog they
// account for.
//
// Holds no data: both inputs are hand-kept in the Research Database
// (server/researchDb.js), because they name holdings.
//   data/curated/ai-flows.json   one row per agreement: from, to, amount ($bn
//                                of contract value), basis (filed, announced,
//                                secondary, reported), checked, firm, source
//   data/curated/backlog.json    each supplier's reported backlog or RPO series
//
// Derived: each company's money in and out (firm against cancellable or capped),
// and, for a supplier with a reported backlog, the labs' firm commitments beside
// it. That last figure is a rough ceiling, not a share: contract value is not
// the unrecognized remainder, and an agreement signed after the backlog date is
// not in it; both dates are returned so the page can say so.
// ============================================================================
const FLOWS = ['data', 'curated', 'ai-flows.json']
const BACKLOG = ['data', 'curated', 'backlog.json']
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)

export function buildFlows(flows, backlog) {
  const nodes = Object.fromEntries((flows.nodes || []).map(n => [n.id, { ...n, in: 0, out: 0, inFirm: 0, outFirm: 0, fromLabs: 0 }]))
  const edges = (flows.edges || []).filter(e => nodes[e.from] && nodes[e.to] && fin(e.amount) && e.amount > 0).map(e => ({ ...e, firm: e.firm !== false, upTo: !!e.upTo, checked: !!e.checked, source: flows.sources?.[e.source] || null }))
  for (const e of edges) {
    const a = nodes[e.from], b = nodes[e.to]
    a.out += e.amount; b.in += e.amount
    if (e.firm) { a.outFirm += e.amount; b.inFirm += e.amount; if (a.tier === 'lab') b.fromLabs += e.amount }
  }
  const suppliers = Object.values(nodes).filter(n => n.backlog && backlog?.tickers?.[n.backlog]).map(n => {
    const series = backlog.tickers[n.backlog].series?.[0], point = [...(series?.points || [])].reverse().find(p => fin(p.value))
    const named = edges.filter(e => e.to === n.id && e.firm)
    return { id: n.id, label: n.label, backlog: point?.value ?? null, backlogAsOf: point?.end || null, backlogLabel: series?.label || null,
      fromLabs: rnd(n.fromLabs), labCeiling: fin(point?.value) && point.value > 0 ? rnd(Math.min(1, n.fromLabs / point.value), 3) : null,
      named: rnd(named.reduce((s, e) => s + e.amount, 0)), payers: named.map(e => ({ from: nodes[e.from].label, amount: e.amount, basis: e.basis, tier: nodes[e.from].tier })) }
  }).sort((a, b) => (b.labCeiling ?? -1) - (a.labCeiling ?? -1))
  return { nodes: Object.values(nodes).map(n => ({ ...n, in: rnd(n.in), out: rnd(n.out), inFirm: rnd(n.inFirm), outFirm: rnd(n.outFirm), fromLabs: rnd(n.fromLabs) })), edges, suppliers,
    totals: { firm: rnd(edges.filter(e => e.firm).reduce((s, e) => s + e.amount, 0)), soft: rnd(edges.filter(e => !e.firm).reduce((s, e) => s + e.amount, 0)), checked: edges.filter(e => e.checked).length, edges: edges.length } }
}

export function createAiFlows({ research }) {
  async function get() {
    const f = await research.read(FLOWS)
    if (!f) return research.missing()
    if (!f.data?.edges?.length) return research.missing('AI compute flows table', FLOWS)
    const b = await research.read(BACKLOG)
    return { available: true, reviewed: f.data.reviewed || null, backlogReviewed: b?.data?.reviewedAt || null, units: f.data.units || null, universe: f.source, researchUrl: research.researchUrl, ...buildFlows(f.data, b?.data) }
  }
  return { get }
}
