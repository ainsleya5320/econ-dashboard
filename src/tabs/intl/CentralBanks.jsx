import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend, Spark } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// CENTRAL BANKS & RATES — BIS policy rates for ~40 central banks: today's rate
// and its last move, 6- and 12-month changes, the global easing/tightening
// breadth since 2000, the majors' paths, and every bank as a small multiple.
// Data: /api/policy-rates (server/policyRates.js — BIS WS_CBPOL, with a newer
// FMP-calendar decision applied where BIS has not caught up). The same feed
// is the base of /api/cb-rates, so the Pulse and Forex scorecards agree.
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLbl = m => (m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "—");
const dLbl = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10) || ""} ${d.slice(0, 4)}`.replace("  ", " ") : "—");
const year = p => String(p).slice(0, 4);
const yearTicks = rows => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y) || +y % 4) return false; seen.add(y); return true; }).map(r => r.p); };
const pct = (v, dp = 2) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const bp = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}bp` : "—");
const mOrd = k => +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1);
const mKey = o => `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
const dec = e => (e?.s ? e.v.map((v, i) => [mKey(mOrd(e.s) + i), v]).filter(p => finite(p[1])) : []);
const REGIONS = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"];
const MAJORS = [["US", C[1]], ["EU", C[2]], ["GB", C[3]], ["JP", C[4]], ["CN", C[5]], ["CA", "var(--text-muted)"]];

export default function CentralBanks() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [region, setRegion] = useState("all"), [sort, setSort] = useState("region");
  useEffect(() => {
    let alive = true;
    fetch("/api/policy-rates").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.banks) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const banks = d?.banks || [];
  const us = banks.find(b => b.id === "US");
  const rows = useMemo(() => banks.filter(b => region === "all" || b.region === region).map(b => ({ ...b, vsUs: finite(b.rate) && finite(us?.rate) && b.id !== "US" ? b.rate - us.rate : null }))
    .sort((a, b) => (sort === "rate" ? b.rate - a.rate : sort === "move" ? (b.since || "").localeCompare(a.since || "") : REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || a.economy.localeCompare(b.economy))), [banks, region, sort, us]);
  const majors = useMemo(() => {
    const by = new Map(), ids = MAJORS.map(m => m[0]);
    for (const b of banks.filter(x => ids.includes(x.id))) for (const [p, v] of dec(b.series)) { const r = by.get(p) || { p }; r[b.id] = v; by.set(p, r); }
    return [...by.values()].sort((a, b) => a.p.localeCompare(b.p));
  }, [banks]);
  const breadth = useMemo(() => (d?.breadth || []).map(([p, hike, cut, n]) => ({ p, hike, cut, n })), [d]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Policy rates are unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading BIS policy rates…</p></div></div>;
  const S = d.summary || {}, lastB = breadth.at(-1);
  const recent = [...banks].filter(b => b.since && !b.stale).sort((a, b) => b.since.localeCompare(a.since)).slice(0, 5);
  const name = id => banks.find(b => b.id === id)?.bank || id;

  return (
    <div className="options-research">
      <p className="ohead-line">
        Over the past six months <strong>{S.hiked6m} central banks raised rates and {S.cut6m} cut</strong> (of {S.banks} reporting; pegged currencies left out). The median policy rate is {pct(S.median)}.
        {" "}Latest moves: {recent.map(b => `${b.bank} ${bp(b.lastMove)} (${dLbl(b.since)})`).join(", ")}.
      </p>

      <div className="okpis" style={{ marginBottom: 12 }}>
        {["US", "EU", "GB", "JP", "CN"].map(id => { const b = banks.find(x => x.id === id); return b ? <Kpi key={id} label={b.bank} value={pct(b.rate)} sub={`${bp(b.lastMove)} on ${dLbl(b.since)} · 12m ${bp(b.chg12m)}`} tone={finite(b.chg6m) && b.chg6m !== 0 ? (b.chg6m > 0 ? "var(--oc-pos)" : "var(--oc-neg)") : undefined} /> : null; })}
        {lastB && <Kpi label="Hiking vs cutting" value={`${fx(lastB.hike, 0)}% / ${fx(lastB.cut, 0)}%`} sub={`of ${lastB.n} banks, trailing 3 months · ${mLbl(lastB.p)}`} />}
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow="BIS · share of central banks that moved over the trailing three months" title="The global cycle"
          finding={lastB ? `${fx(lastB.hike, 0)}% of central banks raised rates over the three months to ${mLbl(lastB.p)} and ${fx(lastB.cut, 0)}% cut. When the two lines cross, the world's monetary cycle has turned.` : ""}
          table={<MiniTable columns={[{ key: "p", label: "Month", fmt: mLbl }, { key: "hike", label: "Hiking %", fmt: v => fx(v, 0) }, { key: "cut", label: "Cutting %", fmt: v => fx(v, 0) }, { key: "n", label: "Banks" }]} rows={[...breadth].reverse()} />}>
          <Legend items={[["Raised rates", "var(--oc-pos)"], ["Cut rates", "var(--oc-neg)"]]} />
          <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={breadth} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(breadth)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} domain={[0, 100]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={mLbl} formatter={(v, n) => [`${fx(v, 0)}%`, n === "hike" ? "Raised rates" : "Cut rates"]} />
              <Line dataKey="hike" stroke="var(--oc-pos)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="cut" stroke="var(--oc-neg)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="BIS · end-of-month policy rate, %" title="The majors since 2000"
          finding={`Each bank's own headline rate: the Fed is the midpoint of its target range, the ECB its deposit rate, the PBoC its 7-day reverse repo.`}
          table={<MiniTable columns={[{ key: "p", label: "Month", fmt: mLbl }, ...MAJORS.map(([id]) => ({ key: id, label: id, fmt: v => pct(v) }))]} rows={[...majors].reverse()} />}>
          <Legend items={MAJORS.map(([id, c]) => [name(id), c])} />
          <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={majors} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(majors)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={mLbl} formatter={(v, n) => [pct(v), name(n)]} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              {MAJORS.map(([id, c]) => <Line key={id} dataKey={id} stroke={c} strokeWidth={id === "US" ? 2.25 : 1.6} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <div style={{ marginTop: 12 }}>
        <VizCard eyebrow={`BIS policy rates · ${banks.length} central banks · latest ${dLbl(d.asOf)}`} title="Every central bank"
          right={<><Seg label="Region" value={region} onChange={setRegion} options={[["all", "All"], ["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"], ["Middle East & Africa", "MEA"]]} /><Seg label="Sort" value={sort} onChange={setSort} options={[["region", "Region"], ["rate", "Rate"], ["move", "Latest move"]]} /></>}>
          <MiniTable maxHeight={560} rows={rows} columns={[
            { key: "economy", label: "Economy", fmt: (v, r) => <span title={r.peg ? `${r.economy}: ${r.peg}` : r.economy}>{v}{r.peg ? <span className="onote" style={{ margin: 0 }}> · peg</span> : ""}</span> },
            { key: "bank", label: "Central bank", align: "left" },
            { key: "rate", label: "Rate", fmt: v => pct(v) },
            { key: "lastMove", label: "Last move", fmt: (v, r) => `${bp(v)} · ${dLbl(r.since)}` },
            { key: "chg6m", label: "6 months", fmt: bp }, { key: "chg12m", label: "12 months", fmt: bp },
            { key: "vsUs", label: "vs Fed", fmt: v => (finite(v) ? signed(v, 2, " pts") : "—") },
            { key: "series", label: "Since 2021", align: "center", fmt: v => <Spark values={dec(v).filter(p => p[0] >= "2021-01").map(p => p[1])} width={84} height={20} /> },
            { key: "date", label: "As of", fmt: (v, r) => `${dLbl(v)}${r.stale ? " (stale)" : ""}${r.decision ? " · calendar" : ""}` },
          ]} />
          <p className="ocard-note">{d.note}{banks.some(b => b.decision) ? " Rows marked “calendar” carry a decision from the FMP economic calendar newer than BIS's last weekly update." : ""}</p>
        </VizCard>
      </div>

      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      <p className="onote">Source: Bank for International Settlements, central bank policy rates (WS_CBPOL), monthly since 1990 and daily for the last 500 days.</p>
    </div>
  );
}
