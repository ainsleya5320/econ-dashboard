import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, ComposedChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend, divBg } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// SHARE OF THE WORLD — Li Lu's sixth principle (Columbia Graham & Dodd event,
// Oct 2026): wealth is best measured as your percentage ownership of global
// purchasing power, not in dollars, gold or any currency, because inflation
// erodes all of them. Made trackable here as value ÷ world GDP in US dollars
// at market exchange rates:
//   assets     growth of $1 in each US asset class (Damodaran's annual
//              returns) divided by world GDP, 1980 = 100: above 100 the asset
//              has gained a share of what the world produces, below it lost.
//   hurdle     world nominal GDP growth in dollars, the rate a portfolio has
//              to compound just to keep its share, against each asset.
//   countries  each economy's share of world output at market rates and at
//              PPP, the shift since 1980, and its share of world stock-market
//              value against its share of world GDP ("fish where the fish
//              are": a low ratio means fewer investors per dollar of economy).
// Data: /api/share-of-world (server/shareOfWorld.js: IMF WEO via DataMapper,
// World Bank market capitalization, Damodaran histretSP).
// ============================================================================

const ASSET_STYLE = { stocks: [C[1], false], bonds: [C[2], false], bills: [C[3], false], realEstate: [C[4], false], gold: [C[5], false], corp: ["var(--text-secondary)", true], cash: ["var(--text-muted)", true] };
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const bn = v => (!finite(v) ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${Math.round(v)}B`);
const FOCUS = ["USA", "CHN", "EURO", "JPN", "IND", "DEU", "GBR"];

// a dumbbell per country: market-rate share and PPP share on one axis
function Dumbbell({ rows }) {
  const W = 760, L = 120, R = 50, rowH = 22, top = 18;
  const max = Math.max(5, ...rows.flatMap(r => [r.shareUsd, r.sharePpp]).filter(finite));
  const x = v => L + (v / max) * (W - L - R);
  const H = top + rows.length * rowH + 6;
  const ticks = [0, 5, 10, 15, 20, 25, 30].filter(t => t <= max + 0.01);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Share of world GDP at market exchange rates and at PPP by country">
      {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 4} stroke="var(--border-subtle)" /><text x={x(t)} y={top - 9} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)" fontFamily="var(--font-number)">{t}%</text></g>)}
      <text x={W - R + 6} y={top - 9} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">PPP÷mkt</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2;
        return (
          <g key={r.iso3}>
            <title>{`${r.name}: ${pct(r.shareUsd)} of world GDP at market rates, ${pct(r.sharePpp)} at PPP`}</title>
            <text x={L - 8} y={y + 4} textAnchor="end" fontSize="11.5" fill="var(--text-primary)" fontFamily="var(--font-body)">{r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}</text>
            {finite(r.shareUsd) && finite(r.sharePpp) && <line x1={x(r.shareUsd)} x2={x(r.sharePpp)} y1={y} y2={y} stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.6" />}
            {finite(r.sharePpp) && <circle cx={x(r.sharePpp)} cy={y} r="5" fill={C[2]} stroke="var(--card-bg)" strokeWidth="2" />}
            {finite(r.shareUsd) && <circle cx={x(r.shareUsd)} cy={y} r="5" fill={C[1]} stroke="var(--card-bg)" strokeWidth="2" />}
            <text x={W - R + 6} y={y + 4} fontSize="10.5" fill="var(--text-secondary)" fontFamily="var(--font-number)">{finite(r.sharePpp) && finite(r.shareUsd) ? `×${(r.sharePpp / r.shareUsd).toFixed(1)}` : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

// share of world stock-market value against share of world GDP, both log
function FishScatter({ rows }) {
  const [hover, setHover] = useState(null);
  const pts = rows.filter(r => finite(r.shareUsd) && finite(r.shareMcap) && r.shareUsd > 0.15 && r.shareMcap > 0.05);
  const W = 520, H = 340, L = 46, B = 34, T = 12, R = 16, lo = 0.1, hi = 70;
  const lx = v => L + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - L - R);
  const ly = v => H - B - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (H - B - T);
  const ticks = [0.1, 0.3, 1, 3, 10, 30];
  const labelled = new Set(pts.filter(p => p.shareUsd >= 2 || p.capToGdp >= 2.2 || p.capToGdp <= 0.35).map(p => p.iso3));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxWidth: 640 }} role="img" aria-label="Share of world stock-market value against share of world GDP">
        {ticks.map(t => (<g key={t}>
          <line x1={lx(t)} x2={lx(t)} y1={T} y2={H - B} stroke="var(--border-subtle)" /><text x={lx(t)} y={H - B + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t}%</text>
          <line x1={L} x2={W - R} y1={ly(t)} y2={ly(t)} stroke="var(--border-subtle)" /><text x={L - 5} y={ly(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t}%</text>
        </g>))}
        <line x1={lx(lo)} y1={ly(lo)} x2={lx(hi)} y2={ly(hi)} stroke="var(--text-muted)" strokeDasharray="4 3" />
        <text x={lx(40)} y={ly(40) - 6} textAnchor="end" fontSize="10" fill="var(--text-muted)">same share of both</text>
        <text x={W - R} y={H - 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">share of world GDP (market rates) →</text>
        <text x={L} y={T - 2} fontSize="10" fill="var(--text-muted)">↑ share of world stock-market value</text>
        {pts.map(p => {
          const crowded = p.capToGdp >= 1;
          return (
            <g key={p.iso3} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
              <circle cx={lx(p.shareUsd)} cy={ly(p.shareMcap)} r="10" fill="transparent" />
              <circle cx={lx(p.shareUsd)} cy={ly(p.shareMcap)} r={hover?.iso3 === p.iso3 ? 6.5 : 5} fill={crowded ? "var(--oc-pos)" : C[1]} stroke="var(--card-bg)" strokeWidth="2"><title>{`${p.name}: ${pct(p.shareUsd)} of world GDP, ${pct(p.shareMcap)} of world stock-market value (${fx(p.capToGdp, 2)}×)`}</title></circle>
              {labelled.has(p.iso3) && <text x={lx(p.shareUsd) + 7} y={ly(p.shareMcap) + 3} fontSize="10" fill="var(--text-secondary)" fontFamily="var(--font-number)">{p.iso3}</text>}
            </g>
          );
        })}
      </svg>
      <div className="onote" style={{ margin: 0, minHeight: 18 }}>{hover ? `${hover.name}: ${pct(hover.shareUsd)} of world GDP, ${pct(hover.shareMcap)} of world stock-market value — ${fx(hover.capToGdp, 2)}× its economic weight` : "Hover a dot for the country."}</div>
    </div>
  );
}

export default function ShareOfWorld() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [span, setSpan] = useState("1980");
  const [sort, setSort] = useState({ key: "shareUsd", dir: -1 });
  useEffect(() => {
    let alive = true;
    fetch("/api/share-of-world").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.world) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);

  const shareChart = useMemo(() => {
    const s = d?.assets?.share; if (!s) return [];
    const from = span === "1980" ? 1980 : span === "2000" ? 2000 : 2010;
    const i0 = s.years.indexOf(from);
    return s.years.map((y, i) => ({ y, ...Object.fromEntries(s.series.map(x => [x.id, finite(x.values[i]) && finite(x.values[i0]) && i0 >= 0 ? (x.values[i] / x.values[i0]) * 100 : null])) })).filter(r => r.y >= from);
  }, [d, span]);
  const hurdle = useMemo(() => (d?.world ? d.world.years.map((y, i) => ({ y, g: d.world.growthUsd[i], c10: d.world.cagr10[i], proj: d.projFrom && y >= d.projFrom })).filter(r => r.y > 1980) : []), [d]);
  const histChart = useMemo(() => {
    const h = d?.countryHistory || {};
    const ids = FOCUS.filter(k => h[k]);
    const years = [...new Set(ids.flatMap(k => h[k].years))].sort((a, b) => a - b);
    return { ids, rows: years.map(y => ({ y, ...Object.fromEntries(ids.map(k => [k, h[k].shareUsd[h[k].years.indexOf(y)] ?? null])) })) };
  }, [d]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The share-of-world data is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading IMF, World Bank and Damodaran data…</p></div></div>;

  const series = d.assets?.series || [], cagr = d.assets?.cagr || [], wc = d.assets?.worldCagr || {};
  const label = id => series.find(s => s.id === id)?.label || id;
  const last = shareChart.at(-1) || {};
  const countries = d.countries || [];
  const top = countries.slice(0, 20);
  const nameOf = iso => (d.countries || []).find(c => c.iso3 === iso)?.name || (iso === "EURO" ? "Euro area" : iso);
  const sorted = [...top].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; return (x == null) - (y == null) || (typeof x === "string" ? x.localeCompare(y) : (x - y)) * sort.dir; });
  const gainers = [...countries].filter(c => finite(c.chgUsd10)).sort((a, b) => b.chgUsd10 - a.chgUsd10);
  const stocksC = cagr.find(c => c.id === "stocks");
  // the 1980-based share (the server rebases to 1980 = 100), independent of the chart's span
  const share80 = id => (d.assets?.share?.series || []).find(s => s.id === id)?.values.filter(finite).at(-1) ?? null;

  return (
    <div className="options-research">
      <p className="ohead-line">
        Li Lu measures wealth not in dollars but as a share of what the whole world produces. World GDP in dollars has compounded {pct(wc.since1980)} a year since 1980 ({pct(wc.last10)} over the last ten years): that is the rate a portfolio must earn just to keep its share.
        {stocksC && finite(stocksC.since1980) && finite(wc.since1980) ? ` US stocks beat it by ${fx(stocksC.since1980 - wc.since1980, 1)} points a year; cash left untouched since 1980 now commands ${fx(share80("cash"), 0)}% of the share it started with.` : ""}
      </p>
      <div className="okpis">
        <Kpi label={`World GDP ${d.latestYear}`} value={bn(d.world?.gdpUsd?.[d.world.years.indexOf(d.latestYear)])} sub="US dollars, market exchange rates (IMF)" />
        <Kpi label="The hurdle" value={pct(wc.last10)} sub={`world GDP growth in USD, last 10 yrs · ${pct(wc.since1980)} since 1980`} />
        {["stocks", "bonds", "gold", "cash"].map(id => { const c = cagr.find(x => x.id === id); return c ? <Kpi key={id} label={label(id).replace(/ \(.*\)/, "")} value={finite(last[id]) ? fx(last[id], 0) : "—"} sub={`share of the world, ${span} = 100 · ${pct(c.since1980)} a yr since 1980`} tone={finite(last[id]) ? (last[id] >= 100 ? C[1] : "var(--oc-pos)") : undefined} /> : null; })}
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`Growth of $1 ÷ world GDP in USD · log scale · ${span} = 100`} title="What each asset is worth as a share of the world"
          right={<Seg label="From" value={span} onChange={setSpan} options={[["1980", "1980"], ["2000", "2000"], ["2010", "2010"]]} />}
          finding={`Above 100 an asset has gained a share of everything the world produces; below, it lost one. Since ${span}: ${series.filter(s => finite(last[s.id])).sort((a, b) => last[b.id] - last[a.id]).map(s => `${label(s.id).replace(/ \(.*\)/, "")} ${fx(last[s.id], 0)}`).join(", ")}.`}
          table={<MiniTable columns={[{ key: "y", label: "Year" }, ...series.map(s => ({ key: s.id, label: label(s.id).replace(/ \(.*\)/, ""), fmt: v => fx(v, 0) }))]} rows={[...shareChart].reverse()} />}
          note={`${d.assets?.source || "Damodaran, histretSP"}: total returns before tax and fees, nominal US dollars. World GDP: IMF World Economic Outlook (${d.weoVintage || "latest"}).`}>
          <Legend items={series.map(s => [label(s.id).replace(/ \(.*\)/, ""), ASSET_STYLE[s.id]?.[0] || C[1], ASSET_STYLE[s.id]?.[1]])} />
          <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={shareChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="y" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} minTickGap={30} />
              <YAxis scale="log" domain={["auto", "auto"]} allowDataOverflow tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => (v >= 100 ? Math.round(v) : v.toFixed(0))} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [fx(v, 0), label(n).replace(/ \(.*\)/, "")]} />
              <ReferenceLine y={100} stroke="var(--text-muted)" label={{ value: "kept its share", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />
              {series.map(s => <Line key={s.id} dataKey={s.id} name={s.id} stroke={ASSET_STYLE[s.id]?.[0] || C[1]} strokeDasharray={ASSET_STYLE[s.id]?.[1] ? "4 3" : undefined} strokeWidth={s.id === "stocks" ? 2.5 : 1.75} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>

        <VizCard eyebrow="World nominal GDP growth in US dollars · IMF" title="The hurdle rate"
          finding={`Bars are each year's growth of world GDP measured in dollars (it includes inflation and currency swings, so it is what a dollar portfolio has to match); the line is the trailing ten-year rate, ${pct(wc.last10)} now. ${d.projFrom ? `Shaded years from ${d.projFrom} are IMF projections.` : ""}`}
          table={<MiniTable columns={[{ key: "id", label: "Asset", fmt: v => label(v).replace(/ \(.*\)/, "") }, { key: "since1980", label: "Since 1980", fmt: v => pct(v) }, { key: "last20", label: "Last 20 yrs", fmt: v => pct(v) }, { key: "last10", label: "Last 10 yrs", fmt: v => pct(v) }]} rows={[...cagr, { id: "World GDP (USD)", ...wc }]} />}>
          <Legend items={[["World GDP growth, year", C[1]], ["Trailing 10-yr", "var(--text-primary)"]]} />
          <div className="ochart" style={{ height: 180 }}><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hurdle} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="y" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} minTickGap={30} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [pct(v), n === "g" ? "World GDP growth (USD)" : "Trailing 10-yr"]} />
              {d.projFrom && <ReferenceArea x1={d.projFrom} x2={hurdle.at(-1)?.y} fill="var(--bg-subtle)" fillOpacity={0.6} />}
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              <Bar dataKey="g" isAnimationActive={false}>{hurdle.map(r => <Cell key={r.y} fill={r.g < 0 ? "var(--oc-pos)" : C[1]} opacity={r.proj ? 0.5 : 1} />)}</Bar>
              <Line dataKey="c10" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer></div>
          <div className="ocard-eyebrow" style={{ margin: "8px 0 4px" }}>Each asset against the hurdle, % a year</div>
          <table className="otable">
            <thead><tr><th style={{ textAlign: "left" }}>Asset</th>{["since1980", "last20", "last10"].map(k => <th key={k} style={{ textAlign: "right" }}>{k === "since1980" ? "Since 1980" : k === "last20" ? "Last 20 yrs" : "Last 10 yrs"}</th>)}</tr></thead>
            <tbody>{cagr.map(c => (
              <tr key={c.id}><td style={{ textAlign: "left" }}>{label(c.id).replace(/ \(.*\)/, "")}</td>
                {["since1980", "last20", "last10"].map(k => { const ex = finite(c[k]) && finite(wc[k]) ? c[k] - wc[k] : null; return <td key={k} style={{ textAlign: "right", background: divBg(finite(ex) ? -ex / 6 : null) }} title={finite(ex) ? `${signed(ex, 1)} pts vs world GDP` : undefined}>{pct(c[k])}</td>; })}
              </tr>))}
              <tr><td style={{ textAlign: "left" }}><strong>World GDP (USD)</strong></td>{["since1980", "last20", "last10"].map(k => <td key={k} style={{ textAlign: "right" }}><strong>{pct(wc[k])}</strong></td>)}</tr>
            </tbody>
          </table>
          <p className="ocard-note">Blue cells beat the hurdle (gained a share of the world), red cells fell short.</p>
        </VizCard>
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`Share of world GDP, ${d.latestYear} · IMF`} title="Who produces the world's output"
          finding={`Blue is each economy's share at market exchange rates (what its output buys abroad), orange its share at purchasing-power parity (what it buys at home). A wide gap means a cheap price level: China is ${pct(countries.find(c => c.iso3 === "CHN")?.shareUsd)} of the world at market rates and ${pct(countries.find(c => c.iso3 === "CHN")?.sharePpp)} at PPP; India ${pct(countries.find(c => c.iso3 === "IND")?.shareUsd)} and ${pct(countries.find(c => c.iso3 === "IND")?.sharePpp)}.`}
          table={<MiniTable columns={[{ key: "name", label: "Economy" }, { key: "shareUsd", label: "Market rates", fmt: v => pct(v, 2) }, { key: "sharePpp", label: "PPP", fmt: v => pct(v, 2) }, { key: "chgUsd10", label: "10-yr chg", fmt: v => signed(v, 2, " pts") }]} rows={top} />}>
          <Legend items={[["Market exchange rates", C[1]], ["Purchasing-power parity", C[2]]]} />
          <Dumbbell rows={top.slice(0, 15)} />
        </VizCard>

        <VizCard eyebrow="Share of world GDP at market rates · IMF, projections shaded" title="The shift since 1980"
          finding={gainers.length ? `Biggest gains in share over the last ten years: ${gainers.slice(0, 3).map(c => `${c.name} ${signed(c.chgUsd10, 1, " pts")}`).join(", ")}; biggest losses: ${gainers.slice(-3).reverse().map(c => `${c.name} ${signed(c.chgUsd10, 1, " pts")}`).join(", ")}.` : ""}
          table={<MiniTable columns={[{ key: "y", label: "Year" }, ...histChart.ids.map(k => ({ key: k, label: nameOf(k), fmt: v => pct(v, 1) }))]} rows={[...histChart.rows].reverse()} />}>
          <Legend items={histChart.ids.slice(0, 5).map((k, i) => [nameOf(k), C[i + 1]])} />
          <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={histChart.rows} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="y" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} minTickGap={30} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [pct(v, 1), nameOf(n)]} />
              {d.projFrom && <ReferenceArea x1={d.projFrom} x2={histChart.rows.at(-1)?.y} fill="var(--bg-subtle)" fillOpacity={0.6} />}
              {histChart.ids.slice(0, 5).map((k, i) => <Line key={k} dataKey={k} stroke={C[i + 1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <VizCard eyebrow={`World Bank market capitalization ${d.mcapYear || ""} · IMF GDP ${d.latestYear} · log scales`} title="Fish where the fish are"
        finding={`Dots above the dashed line hold more of the world's stock-market value than of its output (crowded water, red); below it, less (fewer fishermen, blue). ${countries.filter(c => finite(c.capToGdp) && c.shareUsd >= 1).sort((a, b) => a.capToGdp - b.capToGdp).slice(0, 4).map(c => `${c.name} ${fx(c.capToGdp, 2)}×`).join(", ")} are the least-fished large economies; ${countries.filter(c => finite(c.capToGdp) && c.shareUsd >= 1).sort((a, b) => b.capToGdp - a.capToGdp).slice(0, 3).map(c => `${c.name} ${fx(c.capToGdp, 2)}×`).join(", ")} the most.`}
        note="Market capitalization is of domestic companies listed at home (World Bank), so companies listed abroad count where they list, and a few markets (e.g. Taiwan) are missing from the World Bank's coverage. A low ratio can mean neglect, or state control and capital controls; it is where to look, not a verdict."
        right={null}>
        <div className="ogrid ogrid-2" style={{ marginBottom: 0, alignItems: "start" }}>
          <FishScatter rows={countries} />
          <div className="otable-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="otable">
              <thead><tr>{[["name", "Economy"], ["shareUsd", "GDP share"], ["shareMcap", "Market-value share"], ["capToGdp", "Ratio"], ["chgUsd10", "GDP share, 10-yr chg"]].map(([k, l], i) => <th key={k} style={{ textAlign: i ? "right" : "left" }}><button type="button" onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : (k === "name" ? 1 : -1) }))}>{l}{sort.key === k ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</button></th>)}</tr></thead>
              <tbody>{sorted.map(c => (
                <tr key={c.iso3}><td style={{ textAlign: "left" }}>{c.name}</td><td style={{ textAlign: "right" }}>{pct(c.shareUsd, 2)}</td><td style={{ textAlign: "right" }}>{pct(c.shareMcap, 2)}</td>
                  <td style={{ textAlign: "right", background: divBg(finite(c.capToGdp) && c.capToGdp > 0 ? Math.log2(c.capToGdp) / 2 : null) }}>{finite(c.capToGdp) ? `${fx(c.capToGdp, 2)}×` : "—"}</td>
                  <td style={{ textAlign: "right" }}>{signed(c.chgUsd10, 2, " pts")}</td></tr>))}
              </tbody>
            </table>
          </div>
        </div>
      </VizCard>
      <p className="onote">The idea: Li Lu (Himalaya Capital) at Columbia Business School&apos;s 36th Graham &amp; Dodd event, October 2026 — measure wealth as your percentage ownership of global purchasing power, and hold or grow it by owning great businesses in dynamic economies at good prices. World GDP at market exchange rates is the denominator here because that is what a global investor&apos;s dollars buy; PPP shares measure real output and are shown for countries.</p>
    </div>
  );
}
