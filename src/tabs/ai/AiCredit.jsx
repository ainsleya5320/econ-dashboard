import React, { useEffect, useState } from "react";
import { finite, signed, C, VizCard, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// AI CREDIT BASKET: what the bond market charges the companies building and
// supplying AI capacity, tier by tier. Each issuer is a dot at its median
// spread over Treasuries with a hairline across its bonds' range, all on one
// log scale (spreads here run from under half a point to over ten); the change
// column compares the same bonds on the two dates. Issuers with only
// convertible bonds have no meaningful yield and are listed by price.
// Data: /api/ai-credit (server/aiCredit.js), priced from the corporate tape
// Bonds → Corporate bonds already keeps (personal use). The issuer list is
// hand-kept in the Research Database, so this file names no company.
// ============================================================================

const bp = v => (finite(v) ? `${Math.round(v * 100)}` : "—");
const dbp = v => (finite(v) ? signed(v, 0) : "—");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const right = { textAlign: "right" }, left = { textAlign: "left" };
const worse = v => (!finite(v) || v === 0 ? "var(--text-muted)" : v > 0 ? C[2] : C[1]);   // wider or higher is worse for the borrower

// One issuer on the shared log scale: range hairline, median dot with a surface ring.
function SpreadMark({ i, x, W }) {
  if (!finite(i.spread)) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const a = x(Math.max(0.05, i.lo ?? i.spread)), b = x(Math.max(0.05, i.hi ?? i.spread)), m = x(Math.max(0.05, i.spread));
  return (
    <svg width={W} height={16} role="img" aria-label={`Median spread ${bp(i.spread)} basis points, range ${bp(i.lo)} to ${bp(i.hi)}`} style={{ display: "block" }}>
      <line x1={0} x2={W} y1={8} y2={8} stroke="var(--border-subtle)" />
      {b - a > 1 && <line x1={a} x2={b} y1={8} y2={8} stroke={C[1]} strokeWidth={2} opacity={0.5} />}
      <circle cx={m} cy={8} r={5} fill={C[1]} stroke="var(--card-bg)" strokeWidth={2} />
    </svg>
  );
}

export default function AiCredit() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [open, setOpen] = useState(null), [tier, setTier] = useState("");
  useEffect(() => { let alive = true; fetch("/api/ai-credit").then(r => r.json()).then(j => { if (alive) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => alive && setErr(e.message)); return () => { alive = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The AI credit basket could not be loaded: {err}</p></div>;
  if (!d) return null;
  if (!d.available) return <div className="options-research"><section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">AI credit basket</h3><p className="ocard-finding">{d.reason}</p></section></div>;

  const all = d.groups.flatMap(g => g.issuers), priced = all.filter(i => finite(i.spread));
  const lo = Math.max(0.1, Math.min(...priced.map(i => Math.max(0.05, i.lo ?? i.spread)))) * 0.8, hi = Math.max(...priced.map(i => i.hi ?? i.spread)) * 1.15;
  const W = 230, x = v => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - 12) + 6;
  const ticks = [0.25, 0.5, 1, 2, 5, 10, 20].filter(t => t > lo && t < hi);
  const groups = d.groups.filter(g => !tier || g.id === tier);
  const hy = d.groups.find(g => g.id === "neoclouds"), ig = d.groups.find(g => g.id === "hyperscalers");
  const convs = all.filter(i => i.conv);
  const since = d.prevDay ? `since ${day(d.prevDay)}` : "no earlier snapshot yet";
  const hasSpreadChange = all.some(i => finite(i.dSpread));

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`${priced.length} issuers with plain bonds · ${day(d.asOf)} · median spread over Treasuries, basis points`} title="What the bond market charges the AI build-out"
        finding={`${hy && ig && finite(hy.spread) && finite(ig.spread) ? `The neoclouds and compute borrowers pay a median ${bp(hy.spread)} basis points over Treasuries against ${bp(ig.spread)} for the hyperscalers that buy from them: the gap is the price of standing between a lab's contract and the bank. ` : ""}Each dot is an issuer's median bond, the line its range; the scale is logarithmic. ${hasSpreadChange ? "Changes compare the same bonds on both dates." : "The tape keeps no past Treasury curve, so spread changes start from today; until a second day is on file the change shown is in yield, same bonds on both dates, which includes the move in Treasuries."}`}
        right={<Seg label="Tier" value={tier} onChange={setTier} options={[["", "All"], ...d.groups.map(g => [g.id, g.label])]} />}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          {d.groups.map(g => <Kpi key={g.id} label={g.label} value={finite(g.spread) ? `${bp(g.spread)} bp` : "—"} sub={finite(g.dSpread) ? `${dbp(g.dSpread)} bp ${since}` : finite(g.dYield) ? `yield ${dbp(g.dYield)} bp ${since}` : since} tone={worse(finite(g.dSpread) ? g.dSpread : g.dYield)} />)}
        </div>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr>
              <th style={left}>Issuer</th><th style={left}>Rating</th><th style={right}>Bonds</th><th style={right}>Spread</th>
              <th style={left}><svg width={W} height={14} aria-hidden="true" style={{ display: "block" }}>{ticks.map(t => <text key={t} x={x(t)} y={11} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t * 100}</text>)}</svg></th>
              <th style={right}>Yield</th><th style={right}>{hasSpreadChange ? "Spread Δ" : "Yield Δ"} {d.prevDay ? `(${day(d.prevDay)})` : ""}</th>
            </tr></thead>
            <tbody>{groups.map(g => (
              <React.Fragment key={g.id}>
                <tr><td colSpan={7} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", whiteSpace: "normal" }} title={g.reads || undefined}><strong style={{ color: "var(--text-primary)" }}>{g.label}</strong> <span style={{ color: "var(--text-secondary)" }}>· {g.reads}</span></td></tr>
                {[...g.issuers].filter(i => finite(i.spread)).sort((a, b) => b.spread - a.spread).map(i => {
                  const chg = hasSpreadChange ? i.dSpread : i.dYield;
                  return (
                    <React.Fragment key={i.name}>
                      <tr className="oclick" onClick={() => setOpen(open === i.name ? null : i.name)} title="Show the bonds">
                        <td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: 600 }}>{i.label}</td>
                        <td style={left}>{[i.sp, i.moodys].filter(Boolean).join(" / ") || "—"}</td>
                        <td style={right}>{i.n}</td>
                        <td style={right}>{bp(i.spread)}</td>
                        <td style={left}><SpreadMark i={i} x={x} W={W} /></td>
                        <td style={right}>{finite(i.yield) ? `${i.yield.toFixed(2)}%` : "—"}</td>
                        <td style={{ ...right, color: worse(chg) }}>{dbp(chg)}</td>
                      </tr>
                      {open === i.name && <tr><td colSpan={7} style={{ padding: "4px 7px 8px 24px", whiteSpace: "normal" }}>
                        <table className="otable" style={{ width: "auto" }}><thead><tr><th style={left}>Coupon</th><th style={left}>Maturity</th><th style={right}>Years</th><th style={right}>Price</th><th style={right}>Yield</th><th style={right}>Spread</th><th style={left}>Last trade</th></tr></thead>
                          <tbody>{i.bonds.map((b, k) => <tr key={k}><td style={left}>{finite(b.coupon) ? `${b.coupon.toFixed(3)}%` : "—"}</td><td style={left}>{b.maturity}</td><td style={right}>{b.years}</td><td style={right}>{finite(b.price) ? b.price.toFixed(2) : "—"}</td><td style={right}>{finite(b.yield) ? `${b.yield.toFixed(2)}%` : "—"}</td><td style={right}>{bp(b.spread)}</td><td style={left}>{day(b.last)}</td></tr>)}</tbody></table>
                      </td></tr>}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}</tbody>
          </table>
        </div>
        <Legend items={[["Median bond", C[1]], ["Range across the issuer's bonds", `color-mix(in srgb, ${C[1]} 50%, transparent)`]]} />
      </VizCard>

      {convs.length > 0 && (
        <VizCard eyebrow={`${convs.length} issuers · convertible bonds, by price`} title="Convertibles: the equity-linked end"
          finding="A convertible is a bond plus an option on the shares, so its yield says little and its price moves with the stock. Several of the builders have borrowed only this way; a falling price here is the cheap funding window closing."
          style={{ marginBottom: 12 }}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Issuer</th><th style={right}>Convertibles traded</th><th style={right}>Average price</th><th style={right}>Change, same bonds {d.prevDay ? `(${day(d.prevDay)})` : ""}</th><th style={left}>Also has plain bonds</th></tr></thead>
              <tbody>{[...convs].sort((a, b) => (a.conv.dPrice ?? 0) - (b.conv.dPrice ?? 0)).map(i => (
                <tr key={i.name}><td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: 600 }}>{i.label}</td><td style={right}>{i.conv.n}</td><td style={right}>{finite(i.conv.price) ? i.conv.price.toFixed(1) : "—"}</td>
                  <td style={{ ...right, color: !finite(i.conv.dPrice) || i.conv.dPrice === 0 ? "var(--text-muted)" : i.conv.dPrice < 0 ? C[2] : C[1] }}>{finite(i.conv.dPrice) ? signed(i.conv.dPrice, 1) : "—"}</td>
                  <td style={left}>{finite(i.spread) ? `${bp(i.spread)} bp` : "no"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </VizCard>
      )}
      <p className="onote">
        Source: {d.source}. Plain coupon bonds with over a year left that traded in the past two weeks; {d.days.length} {d.days.length === 1 ? "day" : "days"} on file ({d.days.map(day).join(", ")}), one added each day the corporate tape is read.
        Issuer list hand-kept in the Research Database (reviewed {d.reviewed || "—"}).{d.tapeError ? ` Tape: ${d.tapeError}.` : ""}
      </p>
    </div>
  );
}
