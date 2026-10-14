import React, { useMemo, useState } from "react";
import { finite, fx, Seg } from "./ui.jsx";

// ============================================================================
// Ranges at a glance: one small panel per name with the options-implied
// (risk-neutral) price range for each expiry out to ~4 months, as % of
// today's price. Every panel shares one vertical scale, so a wider fan really
// is a wider range. Shading: the middle 80% (lighter) and middle 50%
// (darker) of the pricing distribution; the line is its median; the
// hairline is today's price; a vertical tick marks earnings. Click a panel to
// open that name's full charts below. Data: /api/options-market scan rows.
// ============================================================================

const W = 170, H = 92, PAD = { l: 26, r: 4, t: 4, b: 14 };

function at(fan, dte, key) {
  const pts = [{ dte: 0, [key]: 100 }, ...fan.filter(f => finite(f[key]))];
  if (dte <= pts[0].dte) return pts[0][key];
  for (let i = 1; i < pts.length; i++) if (pts[i].dte >= dte) { const a = pts[i - 1], b = pts[i]; return a[key] + ((dte - a.dte) / (b.dte - a.dte || 1)) * (b[key] - a[key]); }
  return null;
}

function Mini({ row, lo, hi, maxDays, selected, onPick }) {
  const fan = (row.fan || []).filter(f => f.dte <= maxDays && [f.q10, f.q25, f.q50, f.q75, f.q90].every(finite)).sort((a, b) => a.dte - b.dte);
  const x = d => PAD.l + (d / maxDays) * (W - PAD.l - PAD.r);
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const pts = [{ dte: 0, q10: 100, q25: 100, q50: 100, q75: 100, q90: 100 }, ...fan];
  const band = (a, b) => `M${pts.map(p => `${x(p.dte)},${y(p[a])}`).join("L")}L${[...pts].reverse().map(p => `${x(p.dte)},${y(p[b])}`).join("L")}Z`;
  const line = k => `M${pts.map(p => `${x(p.dte)},${y(p[k])}`).join("L")}`;
  const d30 = fan.length ? [at(fan, 30, "q10"), at(fan, 30, "q90")] : [null, null];
  const earnDte = row.earnings ? Math.round((Date.parse(row.earnings + "T00:00:00Z") - Date.now()) / 864e5) : null;
  const label = `${row.symbol}: 30-day middle 80% ${fx(d30[0], 0)}–${fx(d30[1], 0)}% of today's price${row.earnings ? `; earnings ${row.earnings}` : ""}`;
  return (
    <button type="button" className="omini" aria-pressed={selected} onClick={() => onPick(row.symbol)} title={label} aria-label={label}>
      <div className="omini-head">
        <strong>{row.symbol}</strong>
        <span style={{ color: "var(--text-secondary)" }}>{finite(row.iv30) ? `IV ${fx(row.iv30, 0)}` : ""}</span>
      </div>
      <div className="onote" style={{ margin: 0 }}>{finite(d30[0]) ? `30d: ${fx(d30[0] - 100, 0)}% to +${fx(d30[1] - 100, 0)}%` : "too few strikes"}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-hidden="true">
        {[lo, 100, hi].map(v => <text key={v} x={PAD.l - 3} y={y(v) + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-number)">{Math.round(v)}</text>)}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(100)} y2={y(100)} stroke="var(--border-subtle)" strokeWidth="1" />
        {fan.length > 0 && <>
          <path d={band("q90", "q10")} fill="var(--oc-1)" opacity="0.18" />
          <path d={band("q75", "q25")} fill="var(--oc-1)" opacity="0.38" />
          <path d={line("q50")} fill="none" stroke="var(--oc-1)" strokeWidth="1.5" />
        </>}
        {finite(earnDte) && earnDte > 0 && earnDte <= maxDays && <line x1={x(earnDte)} x2={x(earnDte)} y1={PAD.t} y2={H - PAD.b} stroke="var(--oc-2)" strokeWidth="1.5" />}
        <text x={PAD.l} y={H - 3} fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-number)">today</text>
        <text x={W - PAD.r} y={H - 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-number)">{maxDays}d</text>
      </svg>
    </button>
  );
}

export default function MiniFans({ rows, selected, onPick, title = "Ranges at a glance", empty }) {
  const [maxDays, setMaxDays] = useState(120);
  const [sort, setSort] = useState("width");
  const usable = useMemo(() => (rows || []).filter(r => (r.fan || []).some(f => f.dte <= maxDays)), [rows, maxDays]);
  // one shared vertical scale: the widest middle 80% in view, padded, symmetric around today's price
  const [lo, hi] = useMemo(() => {
    let dev = 10;
    for (const r of usable) for (const f of r.fan || []) if (f.dte <= maxDays) { if (finite(f.q10)) dev = Math.max(dev, 100 - f.q10); if (finite(f.q90)) dev = Math.max(dev, f.q90 - 100); }
    dev = Math.min(80, Math.ceil((dev + 2) / 5) * 5);
    return [100 - dev, 100 + dev];
  }, [usable, maxDays]);
  const width = r => { const f = (r.fan || []).filter(p => p.dte <= maxDays); return f.length ? (at(f, Math.min(30, maxDays), "q90") ?? 0) - (at(f, Math.min(30, maxDays), "q10") ?? 0) : -1; };
  const ordered = [...usable].sort((a, b) => (sort === "width" ? width(b) - width(a) : a.symbol.localeCompare(b.symbol)));
  const missing = (rows || []).filter(r => !usable.includes(r)).map(r => r.symbol);
  return (
    <section className="ocard" style={{ marginBottom: 12 }}>
      <header className="ocard-head">
        <div><div className="ocard-eyebrow">Options-implied price ranges · shared scale · % of today&apos;s price</div><h3 className="ocard-title">{title}</h3></div>
        <div className="ocard-tools">
          <Seg label="Horizon" value={maxDays} onChange={setMaxDays} options={[[45, "45d"], [120, "4m"], [200, "6m"]]} />
          <Seg label="Order" value={sort} onChange={setSort} options={[["width", "Widest first"], ["alpha", "A–Z"]]} />
        </div>
      </header>
      <p className="ocard-finding">Shading is the middle 80% and middle 50% of the market&apos;s pricing distribution at each expiry; the line is its median; an orange tick marks earnings. Same vertical scale in every panel ({lo}% to {hi}%), so a wider fan is a wider priced range. Click a name to open its full charts.</p>
      {ordered.length ? <div className="omini-grid">{ordered.map(r => <Mini key={r.symbol} row={r} lo={lo} hi={hi} maxDays={maxDays} selected={r.symbol === selected} onPick={onPick} />)}</div>
        : <p className="onote">{empty || "No ranges yet: the market scan has not finished, or no name in this list is in the scan."}</p>}
      {missing.length > 0 && <p className="ocard-note">No usable range for {missing.join(", ")} (too few liquid strikes or no listed options).</p>}
      <p className="ocard-note">Risk-neutral: prices for risk, including the cost of protection, not forecasts. Within quoted strikes only.</p>
    </section>
  );
}
