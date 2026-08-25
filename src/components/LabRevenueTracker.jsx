import React, { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceArea,
} from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "./shared.jsx";
import OBSERVATIONS from "../data/labRevenueTracker.json";

// ============================================================================
// AI LAB REVENUE-PER-GIGAWATT TRACKER
// ----------------------------------------------------------------------------
// Master KPI for the AI infra cycle: annualized lab revenue ÷ deployed compute
// footprint. The whole upstream repricing thesis (HBM, neoclouds, spec-built
// data centers) rests on the wedge between what compute COSTS (~$12–15M/MW/yr)
// and what frontier labs EARN from it (~$50–100M/MW/yr). This panel exists to
// catch a PLATEAU: rev-per-MW flattening while deployed GW keeps growing means
// the wedge is closing and the thesis is weakening.
//
// UNIT CONVENTION:  $X million per MW per year  ==  $X billion per GW per year.
// (1 GW = 1,000 MW, and $1B = 1,000 × $1M, so the numbers are identical.)
// That's why rev_per_mw can be computed as simply arr_billions / deployed_gw.
//
// HOW TO UPDATE — there is no API for this; you maintain it by hand.
// Open  src/data/labRevenueTracker.json  and append an object to the array:
//
//   {
//     "date": "2026-11",                // YYYY-MM the number refers to
//     "entity": "OpenAI",               // Anthropic | OpenAI | benchmark
//     "arr_billions": 40,               // annualized run-rate in $B, or null
//     "deployed_gw": 4.2,               // deployed footprint in GW, or null
//     "rev_per_mw_millions": null,      // only if DIRECTLY reported; else null
//                                       //   (it's computed from arr/gw anyway)
//     "source": "The Information 2026-11-04",
//     "confidence": "reported"          // reported | estimate | rumor
//   }
//
// Never guess a field to fill a hole — leave it null. The charts handle gaps.
// New numbers typically leak through:
//   - The Information & Reuters .... lab ARR run-rate leaks
//   - Epoch AI .................... compute stock / capex estimates
//   - SemiAnalysis newsletter ...... rev-per-MW and cost-per-MW anchors
//   - Lab & partner press releases . GW-scale deal announcements
// ============================================================================

// Reference bands (constants, not observations — they frame every chart).
const COST_BAND   = { min: 12, max: 15, label: "Base compute cost", source: "SemiAnalysis rule of thumb, Aug 2026" };
const SPACEX_BAND = { min: 30, max: 50, label: "SpaceX emergency-MW rents", source: "SemiAnalysis, Aug 2026 — what labs PAY for scarce capacity" };

const LAB_COLORS = { Anthropic: "#E8553A", OpenAI: "#10B981", benchmark: "#94a3b8" };
const EXTRA_COLORS = ["#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899"]; // future labs
const CONF_COLORS = { reported: "#4ade80", estimate: "#fbbf24", rumor: "#f87171" };

// $M/MW for one observation: prefer the directly-reported number, else derive
// it from ARR ÷ GW (numerically identical — see unit convention above).
// (exported so The Chain tab can reuse the same math — one source of truth)
export function revPerMw(o) {
  if (o.rev_per_mw_millions != null) return o.rev_per_mw_millions;
  if (o.arr_billions != null && o.deployed_gw != null && o.deployed_gw > 0)
    return o.arr_billions / o.deployed_gw;
  return null;
}

// Status rules, applied per lab to its chronological observations:
//   WEDGE WIDENING  latest rev/MW > previous observation
//   PLATEAU WATCH   flat/declining one period while deployed GW grew
//   KILL SWITCH     flat/declining two consecutive periods while GW grew
// Plus two honest fallbacks the rules imply:
//   BASELINE        fewer than two rev/MW points — nothing to compare yet
//   WEDGE NARROWING rev/MW fell but GW did NOT grow (or is unknown) — bad,
//                   but not the plateau signature (could be capacity shed)
const STATUS = {
  kill:      { rank: 4, title: "KILL SWITCH",     color: "#f87171", note: "Rev-per-MW flat/declining two consecutive periods while deployed GW grew. The wedge is closing — the upstream repricing thesis (HBM, neoclouds, spec data centers) is failing. Re-underwrite everything downstream of compute." },
  plateau:   { rank: 3, title: "PLATEAU WATCH",   color: "#fbbf24", note: "Rev-per-MW went flat/declined for one period while deployed GW grew. One period is noise-compatible — but this is the exact early signature of the plateau. Watch the next print closely." },
  narrowing: { rank: 2, title: "WEDGE NARROWING", color: "#fb923c", note: "Rev-per-MW fell, but deployed GW didn't grow (or is unknown) — not the plateau signature the kill switch looks for, but the spread still compressed." },
  widening:  { rank: 1, title: "WEDGE WIDENING",  color: "#4ade80", note: "Latest rev-per-MW is above the prior observation. Labs are monetizing each megawatt harder — the spread over compute cost is growing and the upstream repricing thesis holds." },
  baseline:  { rank: 0, title: "COLLECTING BASELINE", color: "#818cf8", note: "Fewer than two rev-per-MW observations per lab so far — the indicator needs a second data point to compare against. Add observations as they leak (see the log below)." },
};

export function statusForLab(obs) {
  // obs = one lab's observations, oldest → newest
  const revPts = obs.map(o => ({ date: o.date, rev: revPerMw(o) })).filter(p => p.rev != null);
  if (revPts.length < 2) return STATUS.baseline;

  // Count consecutive flat/declining steps at the END of the series.
  let declines = 0;
  for (let i = revPts.length - 1; i > 0; i--) {
    if (revPts[i].rev <= revPts[i - 1].rev) declines++;
    else break;
  }
  if (declines === 0) return STATUS.widening;

  // Did deployed GW grow across the declining stretch? Use the last KNOWN
  // GW at-or-before each end of the stretch (GW and rev leak on different dates).
  const gwAt = (date) => {
    const known = obs.filter(o => o.deployed_gw != null && o.date <= date);
    return known.length ? known[known.length - 1].deployed_gw : null;
  };
  const gwEnd = gwAt(revPts[revPts.length - 1].date);
  const gwStart = gwAt(revPts[revPts.length - 1 - declines].date);
  const gwGrew = gwEnd != null && gwStart != null && gwEnd > gwStart;

  if (!gwGrew) return STATUS.narrowing;
  return declines >= 2 ? STATUS.kill : STATUS.plateau;
}

const fmtOrDash = (v, f) => (v == null ? "—" : f(v));

// Compact summary for The Chain tab: overall wedge status, the latest known
// rev-per-MW print, and the latest known deployed-GW total across labs.
export function wedgeSummary() {
  const obs = [...OBSERVATIONS].sort((a, b) => a.date.localeCompare(b.date));
  const labs = [...new Set(obs.map(o => o.entity))].filter(e => e !== "benchmark");
  const statuses = labs.map(l => statusForLab(obs.filter(o => o.entity === l)));
  const status = statuses.reduce((w, s) => (s.rank > w.rank ? s : w), STATUS.baseline);
  const revPts = obs.map(o => ({ date: o.date, entity: o.entity, rev: revPerMw(o) })).filter(p => p.rev != null && p.entity !== "benchmark");
  const latestRev = revPts.length ? revPts[revPts.length - 1] : null;
  // latest date where at least one lab reported GW; sum labs' most recent GW at that point
  const gwByLab = {};
  let gwDate = null;
  for (const o of obs) if (o.deployed_gw != null && o.entity !== "benchmark") { gwByLab[o.entity] = o.deployed_gw; gwDate = o.date; }
  const gwTotal = Object.values(gwByLab).reduce((a, b) => a + b, 0) || null;
  return { status, latestRev, gwTotal, gwDate, costBand: COST_BAND, labs };
}

export default function LabRevenueTracker() {
  const model = useMemo(() => {
    // Sort a copy chronologically (YYYY-MM strings sort correctly as text).
    const obs = [...OBSERVATIONS].sort((a, b) => a.date.localeCompare(b.date));
    const entities = [...new Set(obs.map(o => o.entity))];
    const labs = entities.filter(e => e !== "benchmark");
    const dates = [...new Set(obs.map(o => o.date))];

    // Stable color per entity, falling back to a palette for future labs.
    let extraIdx = 0;
    const colorOf = {};
    for (const e of entities) colorOf[e] = LAB_COLORS[e] || EXTRA_COLORS[extraIdx++ % EXTRA_COLORS.length];

    // One row per date for each chart; missing values stay undefined (gaps).
    const revRows = dates.map(d => {
      const row = { d };
      for (const o of obs.filter(x => x.date === d)) {
        const r = revPerMw(o);
        if (r != null) row[o.entity] = r;
      }
      return row;
    });
    const gwRows = dates.map(d => {
      const row = { d };
      for (const o of obs.filter(x => x.date === d)) {
        if (o.deployed_gw != null) row[o.entity] = o.deployed_gw;
      }
      return row;
    });

    // Per-lab status, then the panel headline = the most severe one.
    const labStatus = labs.map(l => ({ lab: l, s: statusForLab(obs.filter(o => o.entity === l)) }));
    const headline = labStatus.reduce((worst, x) => (x.s.rank > worst.rank ? x.s : worst), STATUS.baseline);

    return { obs, entities, labs, colorOf, revRows, gwRows, labStatus, headline };
  }, []);

  const { obs, entities, labs, colorOf, revRows, gwRows, labStatus, headline } = model;
  const tooltipStyle = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };

  return (<>
    <SH>Lab Revenue per Gigawatt — The Wedge</SH>

    {/* ── Status indicator ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: fonts.heading, color: headline.color, letterSpacing: 0.5 }}>{headline.title}</div>
        {labStatus.map(({ lab, s }) => (
          <div key={lab} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "3px 10px" }}>
            <span style={{ color: colorOf[lab], fontWeight: 700 }}>{lab}</span>{" "}
            <span style={{ color: s.color }}>{s.title.toLowerCase()}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.55, marginTop: 8, maxWidth: 860 }}>{headline.note}</div>
    </div>

    {/* ── Chart 1: rev-per-MW over time vs the two reference bands ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, paddingTop: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
        Monetization vs Cost — $M per MW per year (= $B per GW)
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={revRows} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          {/* Shaded bands: what compute costs, and the premium labs will PAY. */}
          <ReferenceArea y1={COST_BAND.min} y2={COST_BAND.max} ifOverflow="extendDomain" fill="#64748b" fillOpacity={0.16}
            label={{ value: `compute cost $${COST_BAND.min}–${COST_BAND.max}M/MW`, position: "insideBottomLeft", fill: "#94a3b8", fontSize: 9, fontFamily: fonts.mono }} />
          <ReferenceArea y1={SPACEX_BAND.min} y2={SPACEX_BAND.max} ifOverflow="extendDomain" fill="#fbbf24" fillOpacity={0.08}
            label={{ value: `SpaceX emergency rents $${SPACEX_BAND.min}–${SPACEX_BAND.max}M/MW`, position: "insideTopLeft", fill: "#b8a04a", fontSize: 9, fontFamily: fonts.mono }} />
          <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} />
          <YAxis domain={[0, "auto"]} tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`$${Number(v).toFixed(1)}M/MW`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
          {/* connectNulls bridges gaps; visible dots matter — data is sparse. */}
          {entities.map(e => (
            <Line key={e} type="monotone" dataKey={e} stroke={colorOf[e]} strokeWidth={e === "benchmark" ? 1.4 : 2.2}
              strokeDasharray={e === "benchmark" ? "5 4" : undefined} dot={{ r: 4, fill: colorOf[e] }}
              connectNulls isAnimationActive={false} name={e === "benchmark" ? "benchmark (GB300 ceiling)" : e} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "0 14px 10px", lineHeight: 1.5 }}>
        The wedge = the gap between the lab lines and the grey cost band. The amber band is what labs pay for
        scarce capacity — a floor under the spread: nobody rents at $30–50M/MW unless a megawatt earns more than that.
      </div>
    </div>

    {/* ── Chart 2: deployed GW per lab ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, paddingTop: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
        Deployed Compute Footprint — GW
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={gwRows} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} />
          <YAxis tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} width={36} unit=" GW" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} GW`, n]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
          {labs.map(l => <Bar key={l} dataKey={l} fill={colorOf[l]} radius={[3, 3, 0, 0]} maxBarSize={38} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "0 14px 10px", lineHeight: 1.5 }}>
        End-2026 bars are lower-bound PROJECTIONS (&quot;&gt;5 GW&quot;), not deployed capacity — sources in the log below. This is
        the denominator: if these bars keep growing while the lines above go flat, that&apos;s the plateau.
      </div>
    </div>

    {/* ── Observation log: every hand-entered data point, with provenance ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
        Observation Log — src/data/labRevenueTracker.json
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, fontFamily: fonts.mono }}>
          <thead>
            <tr style={{ color: "#64748b", textAlign: "left" }}>
              {["Date", "Entity", "ARR $B", "GW", "$M/MW", "Conf.", "Source"].map(h => (
                <th key={h} style={{ padding: "4px 10px 6px 0", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {obs.map((o, i) => {
              const direct = o.rev_per_mw_millions != null;
              const r = revPerMw(o);
              return (
                <tr key={i} style={{ color: "#94a3b8", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "5px 10px 5px 0", whiteSpace: "nowrap" }}>{o.date}</td>
                  <td style={{ padding: "5px 10px 5px 0", color: colorOf[o.entity], fontWeight: 700, whiteSpace: "nowrap" }}>{o.entity}</td>
                  <td style={{ padding: "5px 10px 5px 0" }}>{fmtOrDash(o.arr_billions, v => `$${v}B`)}</td>
                  <td style={{ padding: "5px 10px 5px 0" }}>{fmtOrDash(o.deployed_gw, v => `${v}`)}</td>
                  <td style={{ padding: "5px 10px 5px 0", whiteSpace: "nowrap" }}>{r == null ? "—" : `$${r.toFixed(1)}M${direct ? "" : " (calc)"}`}</td>
                  <td style={{ padding: "5px 10px 5px 0", color: CONF_COLORS[o.confidence] || "#94a3b8" }}>{o.confidence}</td>
                  <td style={{ padding: "5px 0", color: "#64748b", lineHeight: 1.45, minWidth: 220 }}>{o.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 8, lineHeight: 1.5 }}>
        To add a point: edit the JSON file above (an example template is in the comment at the top of
        LabRevenueTracker.jsx). Leave unknown fields null — never estimate to fill a hole. New numbers leak via
        The Information &amp; Reuters (ARR), Epoch AI (compute/capex), the SemiAnalysis newsletter (rev-per-MW
        anchors), and lab/partner press releases (GW deals).
      </div>
    </div>

    <InfoBox color={headline.color}>
      <strong style={{ color: "#cbd5e1" }}>Why this is the master KPI.</strong> A megawatt costs ~$12–15M/yr to
      run and frontier labs currently earn ~$50–100M/yr from it — that spread is what justifies compute repricing
      all the way up the chain: HBM premiums, neocloud rents, spec-built data centers, the GPU-backed debt stack.
      The kill switch fires on the specific signature of the thesis breaking: revenue-per-MW flat or falling for
      two straight periods <em>while the GW keeps landing</em>. Growing ARR is not enough — if ARR merely keeps
      pace with the footprint, the marginal megawatt earns no premium and the upstream bid evaporates.
    </InfoBox>
  </>);
}
