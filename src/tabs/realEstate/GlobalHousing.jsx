import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend, divBg, seqBg } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// GLOBAL HOUSING — breadth next to the US detail: residential property in ~60
// countries, one row each, quarterly. Real prices (BIS, CPI-deflated), how far
// each market sits from its real peak, valuation against its own long-run
// price-to-income and price-to-rent (OECD), and household leverage (BIS credit
// and debt service). Data: /api/global-housing (server/globalHousing.js).
// China's detail lives in International → China; the US in this tab's
// residential views — here both are rows for comparison.
// ============================================================================

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const W = 960, H = 470;
let geoPromise = null;
const qLbl = q => (q ? String(q).replace(/^(\d{4})-Q(\d)$/, "Q$2 $1") : "—");
const year = p => String(p).slice(0, 4);
const yearTicks = rows => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y) || +y % 5) return false; seen.add(y); return true; }).map(r => r.p); };
const pctS = v => signed(v, 1, "%");
const paint = s => (s === "transparent" ? "var(--oc-mid)" : s); // divBg leaves an exact zero unfilled
// compact quarterly series { s, v } → [[quarter, value]]
const qOrd = k => +k.slice(0, 4) * 4 + (+k.slice(6) - 1);
const qKey = o => `${Math.floor(o / 4)}-Q${(o % 4) + 1}`;
const dec = e => (e?.s ? e.v.map((v, i) => [qKey(qOrd(e.s) + i), v]).filter(p => finite(p[1])) : []);
const REGIONS = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"];
const REGION_C = { Americas: C[1], Europe: C[2], "Asia-Pacific": C[3], "Middle East & Africa": C[4] };

// what the map colors by: value, color (diverging around zero, or one-hue for levels), legend stops
const METRICS = {
  real1y: { label: "Real price, 1 yr", short: "Real 1 yr", get: c => c.real?.chg1y, fmt: pctS, fill: v => divBg(v / 15), stops: [-15, -7.5, 0, 7.5, 15], why: "Change in CPI-deflated house prices over the latest four quarters." },
  fromPeak: { label: "Real price vs its peak", short: "vs peak", get: c => c.real?.fromPeak, fmt: pctS, fill: v => divBg(Math.min(0, v) / 40), stops: [-40, -30, -20, -10, 0], why: "How far real prices sit below their highest quarter on record (BIS history, most from 1970)." },
  valuation: { label: "Valuation vs own long-run average", short: "Valuation", get: c => c.valuation, fmt: pctS, fill: v => divBg(v / 60), stops: [-60, -30, 0, 30, 60], why: "OECD price-to-income and price-to-rent against each country's own long-run average, averaged; +40% = 40% above its norm. About 25 countries." },
  hhDebt: { label: "Household debt, % of GDP", short: "HH debt", get: c => c.hhDebt?.v, fmt: v => (finite(v) ? `${v.toFixed(0)}%` : "—"), fill: v => seqBg(v / 120), stops: [0, 30, 60, 90, 120], why: "BIS credit to households and non-profits, market value, % of GDP." },
};

function useWorld() {
  const [geo, setGeo] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    geoPromise = geoPromise || fetch(TOPO_URL).then(r => { if (!r.ok) throw new Error(`map outlines HTTP ${r.status}`); return r.json(); }).then(topo => {
      const features = feature(topo, topo.objects.countries).features.filter(f => f.id !== "010"); // no Antarctica
      const proj = geoNaturalEarth1().fitSize([W, H], { type: "FeatureCollection", features }), path = geoPath(proj);
      return features.map(f => ({ id: f.id, d: path(f) }));
    });
    geoPromise.then(g => alive && setGeo(g)).catch(e => { geoPromise = null; if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);
  return [geo, err];
}

function WorldMap({ countries, metric, selected, onSelect }) {
  const [geo, err] = useWorld(), [hover, setHover] = useState(null);
  const M = METRICS[metric], byNum = useMemo(() => new Map(countries.map(c => [c.num, c])), [countries]);
  if (err) return <p className="onote">World outlines unavailable ({err}); the table has every country.</p>;
  if (!geo) return <p className="onote">Loading world outlines…</p>;
  const h = hover ? byNum.get(hover) : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label={`World map of ${M.label} by country`}>
        {geo.map(g => {
          const c = byNum.get(g.id), v = c ? M.get(c) : null, on = c && finite(v);
          return (
            <path key={g.id || g.d.slice(0, 20)} d={g.d} style={{ fill: on ? paint(M.fill(v)) : "var(--bg-subtle)", stroke: c?.iso2 === selected ? "var(--text-primary)" : "var(--card-bg)", strokeWidth: c?.iso2 === selected ? 1.5 : 0.5, cursor: c ? "pointer" : "default" }}
              onMouseEnter={() => c && setHover(g.id)} onMouseLeave={() => setHover(null)} onClick={() => c && onSelect(c.iso2)}>
              {c && <title>{`${c.name}: ${M.fmt(v)}`}</title>}
            </path>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        <div className="onote" style={{ margin: 0, minHeight: 18 }}>{h ? `${h.name}: ${M.label.toLowerCase()} ${M.fmt(M.get(h))} · real 1 yr ${pctS(h.real?.chg1y)} · vs peak ${pctS(h.real?.fromPeak)} (${qLbl(h.real?.peak)}) · click for detail` : "Hover a country; click one for its detail below. Grey: no data. Hong Kong, Singapore and Malta are too small to draw at this scale (they are in the table)."}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }} aria-label="Color scale">
          {M.stops.map(s => <span key={s} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-number)" }}><i style={{ width: 34, height: 9, borderRadius: 2, background: paint(M.fill(s)) }} />{metric === "hhDebt" ? `${s}%` : `${s > 0 ? "+" : ""}${s}%`}</span>)}
        </div>
      </div>
    </div>
  );
}

// valuation (x) against momentum (y): where each market is in its cycle
function CycleMap({ countries, selected, onSelect }) {
  const [hover, setHover] = useState(null);
  const pts = countries.filter(c => finite(c.valuation) && finite(c.real?.chg1y));
  if (pts.length < 3) return <p className="onote">Too few countries with OECD valuation ratios to draw this.</p>;
  const w = 640, h = 380, L = 46, R = 14, T = 16, B = 34;
  const xe = Math.max(20, ...pts.map(p => Math.abs(p.valuation))) * 1.1, ye = Math.max(6, ...pts.map(p => Math.abs(p.real.chg1y))) * 1.15;
  const x = v => L + ((v + xe) / (2 * xe)) * (w - L - R), y = v => h - B - ((v + ye) / (2 * ye)) * (h - B - T);
  const xt = [-xe, -xe / 2, 0, xe / 2, xe].map(Math.round), yt = [-ye, -ye / 2, 0, ye / 2, ye].map(v => Math.round(v));
  // selective labels: right, left, above, below; otherwise none (hover names it)
  const placed = [], labels = {};
  for (const p of [...pts].sort((a, b) => Math.abs(b.valuation) + 3 * Math.abs(b.real.chg1y) - Math.abs(a.valuation) - 3 * Math.abs(a.real.chg1y))) {
    const t = p.name.length > 14 ? p.iso3 : p.name, tw = t.length * 5.8, cx = x(p.valuation), cy = y(p.real.chg1y);
    const boxes = [[cx + 8, cy - 8, tw, 12, "start", cx + 8], [cx - 8 - tw, cy - 8, tw, 12, "end", cx - 8], [cx - tw / 2, cy - 21, tw, 12, "middle", cx], [cx - tw / 2, cy + 9, tw, 12, "middle", cx]];
    const hit = (a, o) => a[0] < o[0] + o[2] && o[0] < a[0] + a[2] && a[1] < o[1] + o[3] && o[1] < a[1] + a[3];
    const dots = pts.filter(o => o !== p).map(o => [x(o.valuation) - 6, y(o.real.chg1y) - 6, 12, 12]);
    const ok = boxes.find(b => b[0] >= L && b[0] + b[2] <= w && b[1] >= T && !placed.some(o => hit(b, o)) && !dots.some(o => hit(b, o)));
    if (ok) { placed.push(ok); labels[p.iso2] = { t, x: ok[5], y: ok[1] + 10, anchor: ok[4] }; }
  }
  const q = (tx, ty, anchor, text) => <text x={tx} y={ty} textAnchor={anchor} fontSize="10.5" fill="var(--text-muted)">{text}</text>;
  const hv = hover && pts.find(p => p.iso2 === hover);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block", maxWidth: 760 }} role="img" aria-label="Valuation against real price change, by country">
        {xt.map(t => <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={T} y2={h - B} stroke={t === 0 ? "var(--text-muted)" : "var(--border-subtle)"} /><text x={x(t)} y={h - B + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t > 0 ? "+" : ""}{t}%</text></g>)}
        {yt.map(t => <g key={`y${t}`}><line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--text-muted)" : "var(--border-subtle)"} /><text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t > 0 ? "+" : ""}{t}%</text></g>)}
        {q(w - R - 4, T + 12, "end", "expensive and still rising")}
        {q(w - R - 4, h - B - 6, "end", "expensive, correcting")}
        {q(L + 4, h - B - 6, "start", "below its norm and falling")}
        {q(L + 4, T + 12, "start", "below its norm, recovering")}
        <text x={w - R} y={h - 3} textAnchor="end" fontSize="10" fill="var(--text-muted)">valuation vs its own long-run average →</text>
        <text x={L} y={T - 4} fontSize="10" fill="var(--text-muted)">↑ real price change, 1 yr</text>
        {pts.map(p => (
          <g key={p.iso2} onMouseEnter={() => setHover(p.iso2)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(p.iso2)} style={{ cursor: "pointer" }}>
            <circle cx={x(p.valuation)} cy={y(p.real.chg1y)} r="11" fill="transparent" />
            <circle cx={x(p.valuation)} cy={y(p.real.chg1y)} r={p.iso2 === selected || p.iso2 === hover ? 7 : 5.5} style={{ fill: REGION_C[p.region] }} stroke={p.iso2 === selected ? "var(--text-primary)" : "var(--card-bg)"} strokeWidth="2"><title>{`${p.name}: valuation ${pctS(p.valuation)} (as of ${qLbl(p.valuationAsOf)}), real prices ${pctS(p.real.chg1y)} on a year`}</title></circle>
            {labels[p.iso2] && <text x={labels[p.iso2].x} y={labels[p.iso2].y} textAnchor={labels[p.iso2].anchor} fontSize="10" fill="var(--text-secondary)">{labels[p.iso2].t}</text>}
          </g>
        ))}
      </svg>
      <div className="onote" style={{ margin: 0, minHeight: 18 }}>{hv ? `${hv.name}: valuation ${pctS(hv.valuation)} vs its long-run average (price-to-income ${pctS(hv.pti?.v)}, price-to-rent ${pctS(hv.ptr?.v)}; ${qLbl(hv.valuationAsOf)}), real prices ${pctS(hv.real.chg1y)} on a year` : `${pts.length} countries with OECD ratios. Hover for detail; click to open a country below.`}</div>
    </div>
  );
}

function Mini({ c, onSelect, selected }) {
  const pts = dec(c.series?.real);
  if (pts.length < 4) return null;
  const vs = pts.map(p => p[1]), lo = Math.min(...vs, 100), hi = Math.max(...vs, 100), w = 170, h = 46, sp = hi - lo || 1;
  const X = i => 1 + (i / (pts.length - 1)) * (w - 2), Y = v => h - 2 - ((v - lo) / sp) * (h - 4);
  const pk = vs.indexOf(Math.max(...vs));
  return (
    <button type="button" className="ocard" onClick={() => onSelect(c.iso2)} style={{ padding: "7px 9px 4px", textAlign: "left", cursor: "pointer", outline: c.iso2 === selected ? "2px solid var(--oc-1)" : "none", background: "var(--card-bg)", color: "inherit", font: "inherit" }}>
      <strong style={{ display: "block", font: "600 12px var(--font-body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</strong>
      <span className="onote" title={`Real prices ${pctS(c.real?.chg1y)} on a year, ${pctS(c.real?.fromPeak)} vs their ${qLbl(c.real?.peak)} peak`} style={{ display: "block", margin: 0, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pctS(c.real?.chg1y)} 1y · {pctS(c.real?.fromPeak)} vs ’{String(c.real?.peak || "").slice(2, 4)} pk</span>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", height: h }} aria-hidden="true">
        <line x1="0" x2={w} y1={Y(100)} y2={Y(100)} stroke="var(--border-subtle)" />
        <polyline points={pts.map((p, i) => `${X(i)},${Y(p[1])}`).join(" ")} fill="none" style={{ stroke: REGION_C[c.region] }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <circle cx={X(pk)} cy={Y(vs[pk])} r="2.5" style={{ fill: "var(--text-secondary)" }} />
      </svg>
    </button>
  );
}

function Detail({ c, aggregates }) {
  const ref = aggregates.find(a => a.id === (c.region === "Europe" && ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"].includes(c.iso2) ? "XM" : c.advanced ? "5R" : "4T"));
  const refPts = new Map(dec(ref?.series));
  const priceRows = dec(c.series?.real).map(([p, v]) => ({ p, v, ref: refPts.get(p) ?? null }));
  const valRows = (() => { const a = new Map(dec(c.series?.pti)), b = new Map(dec(c.series?.ptr)); return [...new Set([...a.keys(), ...b.keys()])].sort().map(p => ({ p, pti: a.get(p) ?? null, ptr: b.get(p) ?? null })); })();
  const debtRows = dec(c.series?.hhDebt).map(([p, v]) => ({ p, v })), dsrRows = dec(c.series?.dsr).map(([p, v]) => ({ p, v }));
  const axis = rows => ({ dataKey: "p", tick: axisTick, tickLine: false, axisLine: { stroke: "var(--border-subtle)" }, tickFormatter: year, ticks: yearTicks(rows), interval: 0 });
  const chart = (rows, lines, { height = 170, fmt = v => fx(v, 1), ref100 } = {}) => (
    <div className="ochart" style={{ height }}><ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} /><XAxis {...axis(rows)} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} allowDecimals={false} />
        <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={qLbl} formatter={(v, n) => [fmt(v), lines.find(l => l[0] === n)?.[1] || n]} />
        {ref100 && <ReferenceLine y={100} stroke="var(--text-muted)" />}
        {lines.map(([k, , col, dashed]) => <Line key={k} dataKey={k} stroke={col} strokeWidth={dashed ? 1.5 : 2.25} strokeDasharray={dashed ? "4 3" : undefined} dot={false} isAnimationActive={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer></div>
  );
  return (
    <>
      <div className="okpis" style={{ marginBottom: 10 }}>
        <Kpi label="Real price, 1 yr" value={pctS(c.real?.chg1y)} sub={`nominal ${pctS(c.nominal1y)} · ${qLbl(c.real?.asOf)}`} />
        <Kpi label="vs real peak" value={pctS(c.real?.fromPeak)} sub={`peak ${qLbl(c.real?.peak)} · 5 yr ${pctS(c.real?.chg5y)}`} />
        <Kpi label="Valuation" value={pctS(c.valuation)} sub={finite(c.valuation) ? `vs own norm · ${qLbl(c.valuationAsOf)}` : "no OECD ratios"} />
        <Kpi label="Rents, 1 yr" value={pctS(c.rent1y)} sub={c.rentAsOf ? `OECD · ${qLbl(c.rentAsOf)}` : "no OECD rents"} />
        <Kpi label="Household debt" value={finite(c.hhDebt?.v) ? `${c.hhDebt.v.toFixed(0)}% GDP` : "—"} sub={c.hhDebt ? `5 yr ${signed(c.hhDebt.chg5y, 1, " pts")} · peak ${fx(c.hhDebt.peak, 0)}%` : "not in BIS credit"} />
        <Kpi label="Debt service" value={finite(c.dsr?.v) ? `${c.dsr.v.toFixed(1)}% inc.` : "—"} sub={c.dsr ? `${signed(c.dsr.gap, 1, " pts")} vs its avg ${fx(c.dsr.avg, 1)}%` : "BIS covers 17 countries"} />
      </div>
      <div className="ogrid ogrid-3">
        <div>
          <div className="ocard-eyebrow">Real house prices · 2010 = 100</div>
          <Legend items={[[c.name, C[1]], [ref?.name || "Peer group", "var(--text-muted)", true]]} />
          {chart(priceRows, [["v", c.name, C[1]], ["ref", ref?.name || "Peer group", "var(--text-muted)", true]], { ref100: true })}
        </div>
        <div>
          <div className="ocard-eyebrow">Valuation · own long-run average = 100</div>
          {valRows.length ? <><Legend items={[["Price-to-income", C[2]], ["Price-to-rent", C[3]]]} />{chart(valRows, [["pti", "Price-to-income", C[2]], ["ptr", "Price-to-rent", C[3]]], { ref100: true })}</> : <p className="onote">The OECD does not publish valuation ratios for {c.name}.</p>}
        </div>
        <div>
          <div className="ocard-eyebrow">Household debt, % of GDP</div>
          {debtRows.length ? chart(debtRows, [["v", "Household debt, % GDP", C[4]]], { height: dsrRows.length ? 78 : 170, fmt: v => `${fx(v, 1)}%` }) : <p className="onote">Not in the BIS credit statistics.</p>}
          {dsrRows.length > 0 && <><div className="ocard-eyebrow" style={{ marginTop: 6 }}>Debt service, % of income</div>{chart(dsrRows, [["v", "Debt service ratio", C[5]]], { height: 78, fmt: v => `${fx(v, 1)}%` })}</>}
        </div>
      </div>
    </>
  );
}

export default function GlobalHousing() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [metric, setMetric] = useState("real1y"), [sel, setSel] = useState("US"), [region, setRegion] = useState("all"), [sort, setSort] = useState("peak");
  useEffect(() => {
    let alive = true;
    fetch("/api/global-housing").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.built) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const countries = d?.countries || [];
  const M = METRICS[metric];
  const tableRows = useMemo(() => [...countries].sort((a, b) => (M.get(b) ?? -1e9) - (M.get(a) ?? -1e9)), [countries, M]);
  const minis = useMemo(() => countries.filter(c => region === "all" || c.region === region).sort((a, b) => (sort === "peak" ? (a.real?.fromPeak ?? 0) - (b.real?.fromPeak ?? 0) : sort === "1y" ? (b.real?.chg1y ?? -99) - (a.real?.chg1y ?? -99) : a.name.localeCompare(b.name))), [countries, region, sort]);
  const select = iso2 => { setSel(iso2); requestAnimationFrame(() => document.getElementById("gh-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Global housing is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading BIS and OECD house price data…</p></div></div>;
  const S = d.summary || {}, cur = countries.find(c => c.iso2 === sel) || countries[0];
  const hot = countries.filter(c => finite(c.valuation) && c.valuation >= 20 && finite(c.real?.chg1y)).sort((a, b) => b.valuation - a.valuation);
  const deep = countries.filter(c => finite(c.real?.fromPeak) && c.real.fromPeak <= -20).sort((a, b) => a.real.fromPeak - b.real.fromPeak);
  const lc = s => s.toLowerCase();

  return (
    <div className="options-research">
      <p className="ohead-line">
        Real house prices fell over the past year in <strong>{S.fallingReal} of {S.current}</strong> countries; the median moved {pctS(S.medianReal1y)} after inflation ({qLbl(S.latestQ)}).
        {" "}{S.deepFromPeak} markets sit 20% or more below their real peak, among them {deep.slice(0, 6).map(c => `${c.name} (${pctS(c.real.fromPeak)} vs ${year(c.real.peak)})`).join(", ")}; {deep.filter(c => c.real.peak >= "2020").length} of the {deep.length} peaked in the 2020s.
        {" "}Of the {S.withValuation} countries the OECD values, {S.overvalued} are 20%+ above their own long-run norm: {hot.slice(0, 6).map(c => `${c.name} ${pctS(c.valuation)}`).join(", ")}.
      </p>

      <div className="okpis" style={{ marginBottom: 12 }}>
        {(d.aggregates || []).map(a => <Kpi key={a.id} label={a.name} value={pctS(a.real?.chg1y)} sub={`real, 1 yr · ${pctS(a.real?.fromPeak)} vs ${qLbl(a.real?.peak)} peak`} tone={finite(a.real?.chg1y) ? (a.real.chg1y < 0 ? "var(--oc-neg)" : "var(--oc-pos)") : undefined} />)}
      </div>

      <VizCard eyebrow={`BIS · OECD · latest ${qLbl(S.latestQ)} · ${countries.length} countries`} title="Housing around the world"
        right={<Seg label="Map metric" value={metric} onChange={setMetric} options={Object.entries(METRICS).map(([k, m]) => [k, m.short])} />}
        finding={`${M.label}. ${M.why}`}
        table={<MiniTable maxHeight={480} columns={[
          { key: "name", label: "Country", fmt: (v, r) => <button type="button" className="ochip" onClick={() => select(r.iso2)} style={{ border: "none", padding: 0, background: "none", color: "inherit", cursor: "pointer", textDecoration: "underline dotted" }}>{v}</button> },
          { key: "region", label: "Region", align: "left" },
          { key: "real", label: "Real 1 yr", fmt: v => pctS(v?.chg1y) }, { key: "nominal1y", label: "Nominal 1 yr", fmt: pctS },
          { key: "real5", label: "Real 5 yr", fmt: (v, r) => pctS(r.real?.chg5y) }, { key: "pk", label: "vs real peak", fmt: (v, r) => pctS(r.real?.fromPeak) }, { key: "pkq", label: "Peak", fmt: (v, r) => qLbl(r.real?.peak) },
          { key: "valuation", label: "Valuation", fmt: pctS }, { key: "pti", label: "Price/income", fmt: v => pctS(v?.v) }, { key: "ptr", label: "Price/rent", fmt: v => pctS(v?.v) },
          { key: "rent1y", label: "Rents 1 yr", fmt: pctS }, { key: "hhDebt", label: "HH debt % GDP", fmt: v => (finite(v?.v) ? v.v.toFixed(0) : "—") }, { key: "dsr", label: "Debt service vs avg", fmt: v => signed(v?.gap, 1, " pts") },
          { key: "asof", label: "Prices as of", fmt: (v, r) => qLbl(r.real?.asOf) },
        ]} rows={tableRows} />}>
        <WorldMap countries={countries} metric={metric} selected={cur?.iso2} onSelect={select} />
      </VizCard>

      <div style={{ marginTop: 12 }}>
        <VizCard eyebrow="OECD valuation × BIS real prices" title="Where each market is in its cycle"
          finding="Right of centre is expensive against the country's own history (price-to-income and price-to-rent); above the line, real prices are still rising. Expensive and still rising is where a correction has the furthest to go; expensive and correcting is one under way. Dots are colored by region."
          table={<MiniTable columns={[{ key: "name", label: "Country" }, { key: "valuation", label: "Valuation", fmt: pctS }, { key: "valuationAsOf", label: "as of", fmt: qLbl }, { key: "real", label: "Real 1 yr", fmt: v => pctS(v?.chg1y) }]} rows={countries.filter(c => finite(c.valuation)).sort((a, b) => b.valuation - a.valuation)} />}>
          <Legend items={REGIONS.map(r => [r, REGION_C[r]])} />
          <CycleMap countries={countries} selected={cur?.iso2} onSelect={select} />
        </VizCard>
      </div>

      {cur && <div id="gh-detail" style={{ marginTop: 12, scrollMarginTop: 12 }}>
        <VizCard eyebrow={`${cur.region} · ${cur.advanced ? "advanced" : "emerging"} economy`} title={cur.name}
          right={<select value={cur.iso2} onChange={e => setSel(e.target.value)} aria-label="Country" style={{ font: "12px var(--font-body)", background: "var(--card-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 6px" }}>
            {[...countries].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
          </select>}
          finding={`Real prices ${pctS(cur.real?.chg1y)} on a year and ${pctS(cur.real?.fromPeak)} from their ${qLbl(cur.real?.peak)} peak${finite(cur.valuation) ? `; valuation ${pctS(cur.valuation)} against the country's own long-run price-to-income and price-to-rent` : ""}${finite(cur.hhDebt?.v) ? `; household debt ${cur.hhDebt.v.toFixed(0)}% of GDP` : ""}${finite(cur.dsr?.gap) ? `, debt service ${signed(cur.dsr.gap, 1, " pts")} against its average` : ""}.${cur.iso2 === "CN" ? " The full China picture (70-city prices, sales, the household balance sheet) is in International → China." : cur.iso2 === "US" ? " The US in depth (affordability, supply, metros) is in this tab's other views." : ""}`}>
          <Detail c={cur} aggregates={d.aggregates || []} />
        </VizCard>
      </div>}

      <div className="ocard-eyebrow" style={{ margin: "14px 0 6px", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span>Real house prices since 2000, market by market · 2010 = 100 · dot = high since 2000 (the record can be older) · click to open</span>
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          <Seg label="Region" value={region} onChange={setRegion} options={[["all", "All"], ["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"], ["Middle East & Africa", "MEA"]]} />
          <Seg label="Sort" value={sort} onChange={setSort} options={[["peak", "Deepest vs peak"], ["1y", "Strongest 1 yr"], ["name", "A–Z"]]} />
        </span>
      </div>
      <div className="omini-grid" style={{ marginBottom: 12 }}>{minis.map(c => <Mini key={c.iso2} c={c} onSelect={select} selected={cur?.iso2} />)}</div>

      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      <p className="onote">{d.note}</p>
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${String(s.fetched || "").slice(0, 10)})`).join("; ")}. Map outlines: Natural Earth via world-atlas.</p>
    </div>
  );
}
