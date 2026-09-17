// ============================================================================
// TOKEN VOLUME ESTIMATES — OpenAI and Anthropic without their own disclosures
// Nobody outside these companies can measure their token volume. What can be
// done is bound it four independent ways and show the spread honestly.
//   A  compute identity   inference compute spend ÷ cost per million tokens.
//                         The divisor is measured, not assumed: it comes from
//                         the GPU economics feed (InferenceX throughput against
//                         real cost lines). The numerator comes from the
//                         counterparties' mandatory filings — Oracle's and
//                         CoreWeave's remaining performance obligations,
//                         hyperscaler capex — not from the labs.
//   B  revenue ÷ price    API revenue ÷ the lab's realized dollars per million
//                         tokens (Ornn OTPI, which the AI pulse already tracks
//                         per lab: Anthropic prices ~3.5× OpenAI, so equal
//                         revenue is very different token volume).
//   C  calibrated proxy   OpenRouter volume for the lab × a multiplier fitted
//                         at a disclosure event and carried forward. Depends on
//                         a disclosure for the anchor, never for the path. With
//                         no usable anchor it reports nothing.
//   D  physics ceiling    fleet in H100-equivalents × measured tokens/s/GPU ×
//                         hours × utilisation. Nothing can exceed it; an
//                         estimate that does is wrong.
// Everything not fetchable lives in data/ai/token-estimates.json with a source,
// a date and a confidence, and every one of those is printed on the panel.
// Filings come from SEC XBRL company-concept (structured, quarterly, audited).
// Cached 12h, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 12 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null), r3 = v => (fin(v) ? +v.toFixed(3) : null)
const QUAD = 1e15 // a quadrillion tokens, the unit these charts are drawn in
const sleep = ms => new Promise(r => setTimeout(r, ms))

export function createTokenEstimates({ aiPulse, gpuEconomics, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null

  // ── SEC XBRL: one concept per request, 160 ms apart ──────────────────────
  let secNext = 0
  async function xbrl(cik, concept) {
    const slot = Math.max(Date.now(), secNext); secNext = slot + 160
    if (slot > Date.now()) await sleep(slot - Date.now())
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.status === 404) return null // the company does not tag this concept
    if (!r.ok) throw new Error(`SEC ${concept} HTTP ${r.status}`)
    const j = await r.json()
    const unit = Object.keys(j.units || {})[0]
    const rows = (j.units?.[unit] || []).filter(x => /^10-[QK]$/.test(x.form) && fin(x.val))
    // one point per period end, latest filing wins (amendments and restatements)
    const byEnd = new Map()
    for (const x of rows) {
      const prev = byEnd.get(x.end)
      if (!prev || (x.filed || '') > (prev.filed || '')) byEnd.set(x.end, x)
    }
    const pts = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end))
      .map(x => ({ end: x.end, start: x.start || null, val: x.val, form: x.form, filed: x.filed, frame: x.frame || null, instant: !x.start }))
    return { concept, unit, n: pts.length, points: pts.slice(-16), latest: last(pts) || null }
  }

  async function build() {
    const t0 = Date.now()
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'token-estimates.json'), 'utf8'))
    const A = cfg.assumptions
    const [pulse, econ] = await Promise.all([aiPulse().catch(() => null), gpuEconomics().catch(() => null)])

    // ── the measured divisors ──
    // cost per million tokens: cheapest generation actually in service, and the H100
    const chipsByKey = Object.fromEntries((econ?.chips || []).map(c => [c.key, c]))
    const floor = 50 // the "chat" interactivity floor the GPU panel defaults to
    const costPerM = key => chipsByKey[key]?.perM?.[floor]?.owner?.[6] ?? null
    const tpsOf = key => chipsByKey[key]?.throughput?.byFloor?.[floor]?.tps ?? null
    const h100Cost = costPerM('h100'), b200Cost = costPerM('b200')
    const h100Tps = A.h100TokensPerSecond ?? tpsOf('h100')
    const b200Tps = tpsOf('b200')
    const blendedCost = fin(h100Cost) && fin(b200Cost) ? (h100Cost + b200Cost) / 2 : h100Cost ?? b200Cost
    // realized price per million tokens, by lab (Ornn OTPI via the pulse)
    const otpi = pulse?.gpu?.bridge?.otpiByLab || {}
    // OpenRouter weekly volume by lab
    const weekly = pulse?.tokens?.weekly || []
    const orLatest4 = weekly.slice(-4)
    const orFor = lab => (orLatest4.length ? orLatest4.reduce((s, r) => s + (r[lab] || 0), 0) / orLatest4.length : null)
    const orWeek = pulse?.tokens?.week?.d || null

    // ── the mandatory rail ──
    const filings = {}
    for (const [tickerKey, c] of Object.entries(cfg.counterparties)) {
      filings[tickerKey] = { name: c.name, cik: c.cik, serves: c.serves, concepts: {} }
      for (const concept of c.concepts) {
        try { const s = await xbrl(c.cik, concept); if (s) filings[tickerKey].concepts[concept] = s; else filings[tickerKey].concepts[concept] = { concept, untagged: true } }
        catch (e) { console.warn(`token-estimates ${tickerKey} ${concept}:`, e.message); filings[tickerKey].concepts[concept] = { concept, error: e.message } }
      }
    }
    const rpoOf = t => filings[t]?.concepts?.RevenueRemainingPerformanceObligation?.latest ?? null
    const capexOf = t => filings[t]?.concepts?.PaymentsToAcquirePropertyPlantAndEquipment?.latest ?? null

    // ── per lab ──
    const asOf = d => (d && d.asOf ? d.asOf : null)
    const labs = []
    for (const [key, L] of Object.entries(cfg.labs)) {
      const rev = last(L.revenue || []), fleet = last(L.fleet || [])
      const price = otpi[key] ?? null // $ per million tokens realized
      const orTokens = orFor(key)

      // A — compute identity, from the counterparties' backlogs
      // annual inference spend ≈ Σ(counterparty RPO × annual recognition × this lab's share × inference share)
      // A counterparty's backlog counts only to the extent the config says it is
      // this lab's. An unset share contributes nothing and is reported as excluded,
      // because attributing Microsoft's whole Azure book to OpenAI is not an estimate.
      const cps = (L.computeCounterparties || []).map(t => {
        const rpo = rpoOf(t), sh = cfg.counterparties[t]?.rpoShare?.[key] || null
        const attributed = rpo && fin(sh?.value) ? rpo.val * sh.value : null
        return { ticker: t, name: filings[t]?.name, rpoUsd: rpo?.val ?? null, end: rpo?.end ?? null, filed: rpo?.filed ?? null,
          share: fin(sh?.value) ? sh.value : null, shareSource: sh?.source || null, shareConfidence: sh?.confidence || null,
          attributedUsd: attributed, excluded: !fin(attributed), why: !rpo ? 'counterparty does not tag RPO' : !fin(sh?.value) ? 'no share set for this lab' : null }
      })
      const rpoAttributed = cps.reduce((s, c) => s + (c.attributedUsd || 0), 0)
      const annualFromRpo = rpoAttributed * A.quarterlyRecognitionOfRpo
      const inferenceSpend = annualFromRpo * A.inferenceShareOfCloudSpend
      const methodA = fin(blendedCost) && blendedCost > 0 && rpoAttributed > 0
        ? { tokens: (inferenceSpend / blendedCost) * 1e6, inferenceSpendUsd: Math.round(inferenceSpend), costPerM: blendedCost,
            rpoAttributedUsd: Math.round(rpoAttributed), counterparties: cps, excluded: cps.filter(c => c.excluded).map(c => `${c.ticker}: ${c.why}`),
            range: [0.3, 0.7].map(sh => (annualFromRpo * sh / blendedCost) * 1e6) }
        : { unavailable: true, why: 'no counterparty backlog is attributed to this lab', counterparties: cps }

      // B — revenue ÷ realized price
      const apiRev = rev && fin(rev.annualRunRateUsd) && fin(rev.apiShare) ? rev.annualRunRateUsd * rev.apiShare : null
      const methodB = fin(apiRev) && fin(price) && price > 0
        ? { tokens: (apiRev / price) * 1e6, apiRevenueUsd: Math.round(apiRev), realizedPerM: price, asOf: asOf(rev), confidence: rev.confidence, source: rev.source,
            range: [0.5, 2].map(m => (apiRev / (price * m)) * 1e6).sort((a, b) => a - b) }
        : null

      // C — calibrated proxy
      const mult = A.openRouterAnchor?.multipliers?.[key] || null
      const methodC = mult && fin(mult.value) && fin(orTokens)
        ? { tokens: orTokens * 52 * mult.value, multiplier: mult.value, fittedAt: mult.fittedAt, orWeeklyTokens: orTokens, week: orWeek }
        : { unavailable: true, why: mult?.source || 'no anchor', orWeeklyTokens: orTokens, week: orWeek }

      // D — physics ceiling
      const methodD = fleet && fin(fleet.h100Equivalents) && fin(h100Tps)
        ? { tokens: fleet.h100Equivalents * fleet.inferenceShare * h100Tps * 3600 * 8760 * A.utilization,
            h100Equivalents: fleet.h100Equivalents, inferenceShare: fleet.inferenceShare, tps: h100Tps, utilization: A.utilization, asOf: asOf(fleet), confidence: fleet.confidence, source: fleet.source }
        : null

      // the labs' own words, for calibration only
      const disc = (L.disclosures || []).map(d => ({ ...d, annualTokens: fin(d.tokensPerMonth) ? d.tokensPerMonth * 12 : null }))
      const anchor = last(disc.filter(d => fin(d.annualTokens)))

      // cross-check: the spend method A assumes implies a fleet. Does it match the
      // fleet method D assumes? A large gap means one of the hand-entered inputs is
      // wrong, and saying which is more useful than averaging them.
      const h100CostPerYear = fin(chipsByKey.h100?.cost?.total?.[6]) ? chipsByKey.h100.cost.total[6] * 8760 * A.utilization : null
      const impliedFleet = methodA?.inferenceSpendUsd && fin(h100CostPerYear) ? methodA.inferenceSpendUsd / h100CostPerYear : null
      const statedFleet = fleet && fin(fleet.h100Equivalents) ? fleet.h100Equivalents * (fleet.inferenceShare ?? 1) : null
      const consistency = fin(impliedFleet) && fin(statedFleet) && statedFleet > 0
        ? { impliedH100Equivalents: Math.round(impliedFleet), statedH100Equivalents: Math.round(statedFleet), gapX: r1(impliedFleet / statedFleet),
            h100CostPerYearUsd: Math.round(h100CostPerYear),
            verdict: Math.abs(Math.log(impliedFleet / statedFleet)) > Math.log(2)
              ? 'A and D disagree by more than 2x — at least one hand-entered input (the RPO share, the recognition rate, the inference share, or the fleet size) is wrong'
              : 'the compute identity and the fleet estimate are mutually consistent' }
        : null

      const pts = [methodA, methodB, methodC, methodD].filter(m => m && fin(m.tokens)).map(m => m.tokens)
      const band = pts.length ? { low: Math.min(...pts), high: Math.max(...pts), spreadX: r1(Math.max(...pts) / Math.min(...pts)) } : null

      labs.push({
        key, name: L.name, color: L.color, note: L.note || null,
        realizedPerM: price, openRouter: fin(orTokens) ? { weeklyTokens: Math.round(orTokens), annualised: orTokens * 52, week: orWeek } : null,
        methods: {
          A: methodA?.tokens ? { ...methodA, tokensQ: r2(methodA.tokens / QUAD), rangeQ: methodA.range.map(v => r2(v / QUAD)) } : methodA,
          B: methodB ? { ...methodB, tokensQ: r2(methodB.tokens / QUAD), rangeQ: methodB.range.map(v => r2(v / QUAD)) } : null,
          C: methodC?.tokens ? { ...methodC, tokensQ: r2(methodC.tokens / QUAD) } : methodC,
          D: methodD ? { ...methodD, tokensQ: r2(methodD.tokens / QUAD) } : null,
        },
        band: band ? { lowQ: r2(band.low / QUAD), highQ: r2(band.high / QUAD), spreadX: band.spreadX } : null, consistency,
        disclosures: disc.map(d => ({ ...d, annualTokensQ: fin(d.annualTokens) ? r2(d.annualTokens / QUAD) : null })),
        anchor: anchor ? { date: anchor.date, scope: anchor.scope, annualTokensQ: r2(anchor.annualTokens / QUAD), source: anchor.source } : null,
        inputs: { revenue: rev || null, fleet: fleet || null },
      })
    }

    // calibration: where a lab has an anchor, how did each method do against it?
    const calibration = []
    for (const l of labs) {
      if (!l.anchor) continue
      for (const [m, v] of Object.entries(l.methods)) {
        if (!v || !fin(v.tokensQ)) continue
        calibration.push({ lab: l.key, method: m, anchorDate: l.anchor.date, anchorScope: l.anchor.scope, anchorQ: l.anchor.annualTokensQ, estimateQ: v.tokensQ, ratio: r2(v.tokensQ / l.anchor.annualTokensQ) })
      }
    }

    // the ceiling arithmetic, stated once so the panel can show the identity
    const oneMillionH100 = fin(h100Tps) ? h100Tps * 1e6 * 3600 * 8760 * A.utilization : null
    const oneMillionB200 = fin(b200Tps) ? b200Tps * 1e6 * 3600 * 8760 * A.utilization : null

    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H,
      reviewed: cfg.reviewed, knowledgeCutoffWarning: cfg.knowledgeCutoffWarning, assumptions: A,
      measured: { h100CostPerM: h100Cost, b200CostPerM: b200Cost, blendedCostPerM: r3(blendedCost), h100Tps, b200Tps, interactivityFloor: floor,
        oneMillionH100Q: r1(oneMillionH100 / QUAD), oneMillionB200Q: r1(oneMillionB200 / QUAD), otpiByLab: otpi },
      labs, filings, calibration,
      source: 'SEC XBRL company-concept API (remaining performance obligations, capex, revenue — 10-Q and 10-K, quarterly and audited); SemiAnalysis InferenceX throughput and the dashboard\'s GPU cost lines for the measured cost per million tokens; Ornn realized price per million tokens by lab and OpenRouter volume by lab via the AI pulse; revenue run-rates, fleet sizes and disclosure anchors hand-entered in data/ai/token-estimates.json with sources and confidences. No lab supplies any figure here except where marked as its own disclosure.',
      caveat: 'These are estimates, not measurements. No method sees consumer surfaces (ChatGPT, Claude.ai) except the physics ceiling, and the single largest swing factor — the share of compute serving inference rather than training — is not disclosed by anyone.',
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load('token-estimates-out.json'); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; save('token-estimates-out.json', d); return d }
      catch (e) { console.warn('token estimates build:', e.message); const disk = mem || load('token-estimates-out.json'); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get }
}
