import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, Legend, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";

// ============================================================================
// CAPEX RETURNS — does the AI build-out earn its cost of capital?
// The reproducible half of Mauboussin & Callahan, "To Free or Not to Free
// (Cash Flow)" (Counterpoint Global, 17 Sep 2026): free cash flow with stock
// compensation removed, ROIC, their lagged three-year ROIIC, and Dickinson
// life-cycle staging — all from SEC XBRL, actuals only.
// Data: /api/capex-returns (server/capexReturns.js).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const bn = v => (!fin(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v / 1e9).toFixed(1)}B`);
const pc = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const th = (t, a = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: a, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const Pill = ({ children, color = SLATE, title }) => <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, whiteSpace: "nowrap" }}>{children}</span>;
const chip = (k, v, color = "#e2e8f0", sub) => (
  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 108 }}>
    <span style={{ ...label, fontSize: 8.5 }}>{k}</span><span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{v}</span>{sub && <span style={{ ...note, fontSize: 8.5 }}>{sub}</span>}
  </div>
);
const STAGE = { introduction: "#64748b", growth: GREEN, maturity: INDIGO, "shake-out": AMBER, decline: RED };

export default function CapexReturnsPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fetch("/api/capex-returns").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e))); }, []);
  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Capex returns could not load: {err}</div>;
  if (!d) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading SEC XBRL filings for the hyperscalers…</div>;

  const C = d.combined, last = C[C.length - 1], first = C[0];
  const base = C[C.length - 6] || first;   // five years back
  const cos = d.companies.filter(c => c.years?.length);
  const hypers = cos.filter(c => c.hyper);
  const capexGrowth = base && last && base.capex > 0 ? last.capex / base.capex : null;
  const chart = C.map(y => ({ fy: y.fy, fcf: fin(y.fcf) ? y.fcf / 1e9 : null, capex: fin(y.capex) ? -y.capex / 1e9 : null, roic: y.roic, roiic: y.roiic }));
  const years = [...new Set(cos.flatMap(c => c.years.map(y => y.fy)))].sort().slice(-10);

  const Hover = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    const y = C.find(x => x.fy === l);
    if (!y) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{l} · five hyperscalers</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>free cash flow {bn(y.fcf)} <span style={{ color: DIM }}>({bn(y.fcfStandard)} before the stock-comp adjustment)</span></div>
        <div style={{ fontSize: 10.5 }}>capital expenditure {bn(y.capex)} · operating cash flow {bn(y.cfo)}</div>
        <div style={{ fontSize: 10.5, color: CYAN, marginTop: 3 }}>ROIC {pc(y.roic)} · ROIIC {pc(y.roiic)} · cost of capital {d.wacc}%</div>
      </div>
    );
  };

  return (<>
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>Capex returns · does the build-out earn its cost of capital?</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            {capexGrowth ? `Hyperscaler capex has gone ${capexGrowth.toFixed(1)}× in five years` : "Hyperscaler capex and returns"} — and the marginal dollar still earns {pc(last?.roiic)} against a {d.wacc}% cost of capital
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5, maxWidth: 940 }}>
            The sign of free cash flow means nothing on its own. Walmart ran negative free cash flow for fourteen straight years to 1986 while earning 18% on capital, and returned 33% a year to shareholders. What matters is the return on the money going in — so this shows the cash flow, the capital, and what the capital earns, together.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }}>
          built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · SEC XBRL, actuals only<br />
          method after Mauboussin &amp; Callahan, Counterpoint Global, 17 Sep 2026
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {chip(`capex, ${last?.fy}`, bn(last?.capex), AMBER, `from ${bn(base?.capex)} in ${base?.fy}`)}
        {chip("free cash flow", bn(last?.fcf), fin(last?.fcf) && last.fcf < 0 ? RED : "#e2e8f0", `${bn(last?.fcfStandard)} before the SBC adjustment`)}
        {chip("return on capital", pc(last?.roic), last?.roic > d.wacc ? GREEN : RED, `${(last?.roic / d.wacc).toFixed(1)}× the ${d.wacc}% cost of capital`)}
        {chip("on the marginal dollar", pc(last?.roiic), last?.roiic > d.wacc ? GREEN : RED, "three-year ROIIC, one-year lag")}
        {chip("negative FCF", d.headline.negativeFcf.join(" · ") || "none", d.headline.negativeFcf.length ? AMBER : SLATE, "latest fiscal year")}
      </div>
    </div>

    <div style={{ ...card, padding: "10px 10px 4px", marginBottom: 12 }}>
      <div style={{ ...label, paddingLeft: 4 }}>Five hyperscalers · cash flow against capital, and what the capital earns</div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chart} margin={{ top: 14, right: 10, left: -8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="fy" tick={axis} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={v => `$${v}B`} />
          <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={v => `${v}%`} />
          <Tooltip content={<Hover />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono }} />
          <ReferenceLine yAxisId="l" y={0} stroke="rgba(255,255,255,0.2)" />
          <ReferenceLine yAxisId="r" y={d.wacc} stroke={RED} strokeDasharray="4 3" label={{ value: `cost of capital ${d.wacc}%`, position: "insideTopRight", fontSize: 9, fill: RED }} />
          <Bar yAxisId="l" dataKey="capex" name="capital expenditure" fill={AMBER} radius={[0, 0, 3, 3]} />
          <Bar yAxisId="l" dataKey="fcf" name="free cash flow (after stock comp)" fill={INDIGO} radius={[3, 3, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="roic" name="ROIC" stroke={GREEN} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line yAxisId="r" type="monotone" dataKey="roiic" name="ROIIC (marginal)" stroke={CYAN} strokeWidth={1.8} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ ...note, padding: "2px 4px 4px" }}>Capex is drawn below the line to show what is going out against what is left over. Free cash flow here is operating cash flow minus stock-based compensation minus capex — the paper&apos;s definition, which moves stock comp to financing because it is really two transactions, issuing shares and paying people. Both returns are measured against beginning invested capital (equity plus debt less cash and near-cash).</div>
    </div>

    <div style={{ ...card, padding: "10px 10px 6px", marginBottom: 12 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{[["Company", "left"], ["FY", "right"], ["Op. cash flow", "right"], ["Capex", "right"], ["Stock comp", "right"], ["FCF", "right"], ["FCF, common defn", "right"], ["ROIC", "right"], ["ROIIC", "right"], ["Life-cycle stage", "left"]].map(([t, a]) => th(t, a))}</tr></thead>
          <tbody>
            {cos.map(c => {
              const y = c.years[c.years.length - 1];
              return (
                <tr key={c.t} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: c.hyper ? "rgba(129,140,248,0.05)" : undefined }}>
                  {td(<><span style={{ color: c.color, fontWeight: 700 }}>{c.t}</span><span style={{ color: DIM, marginLeft: 6, fontSize: 9.5 }}>{c.name}</span>{c.hyper && <Pill color={INDIGO}>hyperscaler</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
                  {td(y.fy)}
                  {td(bn(y.cfo))}
                  {td(bn(y.capex), AMBER)}
                  {td(<span title={`${y.sbcDrag}% of operating cash flow`}>{bn(y.sbc)}</span>, VIOLET)}
                  {td(bn(y.fcf), fin(y.fcf) && y.fcf < 0 ? RED : GREEN)}
                  {td(bn(y.fcfStandard), DIM)}
                  {td(<>{pc(y.roic)}{y.taxRateAssumed && <Pill color={AMBER} title="effective tax rate not tagged annually; 21% assumed">est.</Pill>}</>, fin(y.roic) && y.roic > d.wacc ? GREEN : SLATE)}
                  {td(<span title={y.roiicNote || (y.roiicWindow ? `NOPAT ${y.roiicWindow.nopatFrom}→${y.roiicWindow.nopatTo} over capital added ${y.roiicWindow.icFrom}→${y.roiicWindow.icTo}` : "")}>{fin(y.roiic) ? pc(y.roiic) : <span style={{ color: DIM, borderBottom: "1px dotted rgba(255,255,255,0.2)", cursor: "help" }}>n/a</span>}</span>, fin(y.roiic) && y.roiic > d.wacc ? GREEN : fin(y.roiic) ? RED : SLATE)}
                  {td(<span style={{ color: STAGE[y.stage] || SLATE }}>{y.stage}</span>, SLATE, { textAlign: "left" })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ ...note, padding: "6px 4px 2px" }}>Each company&apos;s own fiscal year. Stock comp runs {Math.min(...cos.map(c => c.years[c.years.length - 1].sbcDrag ?? 99)).toFixed(0)}–{Math.max(...cos.map(c => c.years[c.years.length - 1].sbcDrag ?? 0)).toFixed(0)}% of operating cash flow across this group, which is the whole difference between the two free-cash-flow columns.</div>
    </div>

    <div style={{ ...card, padding: "10px 10px 6px", marginBottom: 12 }}>
      <div style={{ ...label, paddingLeft: 4, marginBottom: 6 }}>Life cycle · Dickinson stage from the signs of operating, investing and financing cash flow</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("", "left")}{years.map(y => th(String(y)))}</tr></thead>
          <tbody>
            {cos.map(c => (
              <tr key={c.t} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {td(<span style={{ color: c.color, fontWeight: 700 }}>{c.t}</span>, "#cbd5e1", { textAlign: "left" })}
                {years.map(fy => {
                  const y = c.years.find(x => x.fy === fy);
                  return <td key={fy} style={{ padding: "3px 4px", textAlign: "center" }}>
                    {y?.stage ? <span title={`${y.stage} · CFO ${bn(y.cfo)} / CFI ${bn(y.cfi)} / CFF ${bn(y.cff)}`} style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: STAGE[y.stage], opacity: 0.85, cursor: "help" }} /> : <span style={{ color: DIM, fontSize: 9 }}>·</span>}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {Object.entries(STAGE).map(([k, v]) => <span key={k} style={{ ...note, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: v, display: "inline-block" }} />{k}</span>)}
      </div>
      <div style={{ ...note, marginTop: 6 }}>A firm can move backwards, and that is the finding: {d.headline.stageShifts.filter(s => s.from && s.from.stage === "maturity" && s.stage === "growth").map(s => `${s.t} returned to growth in ${s.fy}`).join(", ") || "no hyperscaler has returned to growth in this window"}. Spending heavily enough on new capacity re-classifies a mature company as a growing one.</div>
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How this bears on the depreciation argument above.</strong> The GPU panel asks whether a chip clears its own cost over a three- or six-year life. This asks the question one layer up: whether the whole capital programme earns more than the money costs. On the latest full year the five hyperscalers put {bn(last?.capex)} into the ground, took {bn(last?.fcf)} of free cash flow out, and earned {pc(last?.roic)} on capital with {pc(last?.roiic)} on the marginal dollar — against a cost of capital around {d.wacc}%. That is the bull case stated numerically, and it is why "free cash flow collapsed" is not by itself an argument. The bear case has to be that the returns fall, not that the cash flow did. {d.source}
    </InfoBox>
  </>);
}
