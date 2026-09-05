import React, { useState, useEffect, useMemo } from "react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  Area, AreaChart, BarChart, Bar, Cell, ReferenceLine,
  ScatterChart, Scatter, CartesianGrid, ZAxis, LineChart, Line,
} from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

/* ═══════════════════════════════════════════════════════════
   FRED Series used
   ───────────────────────────────────────────────────────────
   UNRATE      Unemployment Rate (U-3), monthly, %
   U6RATE      U-6 Unemployment (broad), monthly, %
   PAYEMS      Total Nonfarm Payrolls, monthly, thousands
   ICSA        Initial Jobless Claims, weekly, persons
   CCSA        Continued Claims, weekly, persons
   JTSJOL      JOLTS Job Openings, monthly, thousands
   JTSQUR      JOLTS Quits Rate, monthly, %
   CIVPART     Labor Force Participation Rate, monthly, %
   LNS11300060 Prime-Age (25-54) LFPR, monthly, %
   CES0500000003 Avg Hourly Earnings (Private), monthly, $/hr
   SAHMREALTIME Sahm Rule Recession Indicator, monthly, pp
   ═══════════════════════════════════════════════════════════ */

const SERIES = {
  UNRATE:         { label: "Unemployment (U-3)",     color: "#E8553A", limit: 600 },
  U6RATE:         { label: "U-6 Unemployment",        color: "#F97316", limit: 300 },
  PAYEMS:         { label: "Nonfarm Payrolls",        color: "#3B82F6", limit: 600 },
  ICSA:           { label: "Initial Claims",          color: "#8B5CF6", limit: 200 },
  CCSA:           { label: "Continued Claims",        color: "#EC4899", limit: 200 },
  JTSJOL:         { label: "JOLTS Openings",          color: "#10B981", limit: 300 },
  JTSQUR:         { label: "JOLTS Quits Rate",        color: "#F59E0B", limit: 300 },
  CIVPART:        { label: "LFPR (Total)",            color: "#6366F1", limit: 600 },
  LNS11300060:    { label: "Prime-Age LFPR",          color: "#14B8A6", limit: 600 },
  CES0500000003:  { label: "Avg Hourly Earnings",     color: "#818cf8", limit: 300 },
  SAHMREALTIME:   { label: "Sahm Rule",              color: "#EF4444", limit: 200 },
};

const BATCH = 4;

function LaborSubTab({ fredKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState("10Y");

  useEffect(() => {
    if (!fredKey || data) return;
    setLoading(true);
    (async () => {
      const result = {};
      const entries = Object.entries(SERIES);
      for (let b = 0; b < entries.length; b += BATCH) {
        const batch = entries.slice(b, b + BATCH);
        const fetched = await Promise.all(
          batch.map(async ([id, meta]) => {
            try {
              const obs = await fetchFred(id, fredKey, meta.limit);
              return [id, obs];
            } catch { return [id, []]; }
          })
        );
        fetched.forEach(([id, obs]) => { result[id] = obs; });
        if (b + BATCH < entries.length) await new Promise(r => setTimeout(r, 400));
      }
      setData(result);
      setLoading(false);
    })();
  }, [fredKey, data]);

  // ── Derived data ──
  const latest = (id) => {
    const arr = data?.[id];
    return arr?.length ? arr[arr.length - 1] : null;
  };
  const latestVal = (id) => latest(id)?.v ?? null;
  const latestDate = (id) => latest(id)?.d ?? null;

  // Range filter helper
  const rangeMonths = range === "5Y" ? 60 : range === "10Y" ? 120 : range === "20Y" ? 240 : range === "MAX" ? 9999 : 120;
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - rangeMonths);
    return d.toISOString().slice(0, 10);
  }, [rangeMonths]);
  const filterRange = (arr) => (arr || []).filter(p => p.d >= cutoff);

  // Payroll monthly change (MoM)
  const payrollChange = useMemo(() => {
    const raw = filterRange(data?.PAYEMS || []);
    if (raw.length < 2) return [];
    return raw.slice(1).map((p, i) => ({
      d: p.d,
      v: p.v - raw[i].v,
    }));
  }, [data, cutoff]);

  // Average hourly earnings YoY %
  const earningsYoY = useMemo(() => {
    const raw = data?.CES0500000003 || [];
    if (raw.length < 13) return [];
    const hist = [];
    for (let i = 12; i < raw.length; i++) {
      const prev = raw[i - 12].v;
      if (prev > 0) hist.push({ d: raw[i].d, v: parseFloat((((raw[i].v - prev) / prev) * 100).toFixed(1)) });
    }
    return hist.filter(p => p.d >= cutoff);
  }, [data, cutoff]);

  // Beveridge Curve: JOLTS openings rate (openings/labor force proxy) vs Unemployment
  const beveridge = useMemo(() => {
    const unr = data?.UNRATE || [];
    const jolts = data?.JTSJOL || [];
    if (!unr.length || !jolts.length) return [];
    // Match by month (both monthly)
    const jMap = {};
    jolts.forEach(j => { jMap[j.d.slice(0, 7)] = j.v; });
    return unr
      .filter(u => u.d >= cutoff)
      .map(u => {
        const openings = jMap[u.d.slice(0, 7)];
        if (openings == null) return null;
        return { unemployment: u.v, openings: openings / 1000, date: u.d };
      })
      .filter(Boolean);
  }, [data, cutoff]);

  // Latest payroll change
  const lastPayrollChg = payrollChange.length ? payrollChange[payrollChange.length - 1].v : null;

  // Range toggle
  const rangeBtn = (r) => ({
    padding: "4px 12px", border: "1px solid " + (range === r ? "#818cf8" : "rgba(255,255,255,0.08)"),
    background: range === r ? "rgba(129,140,248,0.15)" : "transparent",
    color: range === r ? "#c7d2fe" : "#94a3b8",
    fontSize: 10, fontWeight: range === r ? 600 : 400, fontFamily: fonts.mono,
    borderRadius: 6, cursor: "pointer",
  });

  if (loading || !data) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Loading labor market data…</div>
        <div style={{ fontSize: 11, color: "#475569" }}>Fetching {Object.keys(SERIES).length} FRED series</div>
      </div>
    );
  }

  return (<>
    <SH>Labor Market Overview</SH>

    {/* KPI tiles */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Unemployment (U-3)" value={latestVal("UNRATE")} color="#E8553A" subtitle="Headline rate" date={latestDate("UNRATE")} small />
      <RateCard label="U-6 Unemployment" value={latestVal("U6RATE")} color="#F97316" subtitle="Incl. underemployed" date={latestDate("U6RATE")} small />
      <RateCard label="Monthly Payrolls" value={lastPayrollChg} color={lastPayrollChg >= 0 ? "#4ade80" : "#f87171"} format="plain" subtitle={lastPayrollChg != null ? `${lastPayrollChg > 0 ? "+" : ""}${lastPayrollChg.toFixed(0)}K jobs` : null} date={payrollChange.length ? payrollChange[payrollChange.length - 1].d : null} small />
      <RateCard label="Initial Claims" value={latestVal("ICSA")} color="#8B5CF6" format="plain" subtitle={latestVal("ICSA") != null ? `${(latestVal("ICSA") / 1000).toFixed(0)}K weekly` : null} date={latestDate("ICSA")} small />
      <RateCard label="JOLTS Openings" value={latestVal("JTSJOL")} color="#10B981" format="plain" subtitle={latestVal("JTSJOL") != null ? `${(latestVal("JTSJOL") / 1000).toFixed(1)}M` : null} date={latestDate("JTSJOL")} small />
      <RateCard label="Sahm Rule" value={latestVal("SAHMREALTIME")} color={latestVal("SAHMREALTIME") >= 0.5 ? "#EF4444" : "#4ade80"} subtitle={latestVal("SAHMREALTIME") >= 0.5 ? "⚠ Recession signal" : "Below 0.50 threshold"} date={latestDate("SAHMREALTIME")} small />
    </div>

    {/* Range selector */}
    <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
      {["5Y", "10Y", "20Y", "MAX"].map(r => (
        <button key={r} onClick={() => setRange(r)} style={rangeBtn(r)}>{r}</button>
      ))}
    </div>

    {/* Unemployment Rate chart */}
    <SH>Unemployment Rate</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={filterRange(data.UNRATE || []).map(p => {
          const u6 = (data.U6RATE || []).find(x => x.d === p.d);
          return { d: p.d, UNRATE: p.v, U6RATE: u6?.v };
        })} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="g-unrate" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E8553A" stopOpacity={0.25} /><stop offset="95%" stopColor="#E8553A" stopOpacity={0} /></linearGradient>
            <linearGradient id="g-u6" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F97316" stopOpacity={0.15} /><stop offset="95%" stopColor="#F97316" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(filterRange(data.UNRATE || []).length / 8) - 1)} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`${v.toFixed(1)}%`]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="U6RATE" name="U-6 (Broad)" stroke="#F97316" fill="url(#g-u6)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="UNRATE" name="U-3 (Headline)" stroke="#E8553A" fill="url(#g-unrate)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <InfoBox color="#E8553A">
      <strong style={{ color: "var(--text-primary)" }}>U-3 vs U-6:</strong> U-3 is the headline unemployment rate (people actively looking for work). U-6 adds discouraged workers and those working part-time who want full-time jobs — a broader measure of labor market slack.
    </InfoBox>

    {/* Nonfarm Payrolls monthly change */}
    <SH>Nonfarm Payrolls — Monthly Change</SH>
    {payrollChange.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={payrollChange} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(payrollChange.length / 8) - 1)} tickFormatter={fmtAxisDate} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}K`} />
            <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`${v > 0 ? "+" : ""}${v.toFixed(0)}K`, "Jobs Added"]} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Bar dataKey="v" radius={[2, 2, 0, 0]}>
              {payrollChange.map((p, i) => (
                <Cell key={i} fill={p.v >= 0 ? "#4ade80" : "#f87171"} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Jobless Claims */}
    <SH>Jobless Claims</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={filterRange(data.ICSA || []).map(p => {
          const cc = (data.CCSA || []).find(x => x.d === p.d);
          return { d: p.d, ICSA: p.v / 1000, CCSA: cc ? cc.v / 1000 : null };
        })} margin={{ top: 5, right: 8, left: -5, bottom: 0 }}>
          <defs>
            <linearGradient id="g-icsa" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.25} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
            <linearGradient id="g-ccsa" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EC4899" stopOpacity={0.15} /><stop offset="95%" stopColor="#EC4899" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(filterRange(data.ICSA || []).length / 8) - 1)} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}K`} />
          <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v, n) => [`${v.toFixed(0)}K`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="CCSA" name="Continued Claims" stroke="#EC4899" fill="url(#g-ccsa)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="ICSA" name="Initial Claims" stroke="#8B5CF6" fill="url(#g-icsa)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "var(--text-primary)" }}>Jobless Claims</strong> are weekly, making them the most timely labor indicator. Initial claims measure new layoffs; continued claims track ongoing unemployment. Spikes above 300K initial claims often signal economic stress.
    </InfoBox>

    {/* JOLTS: Job Openings */}
    <SH>JOLTS — Job Openings & Quits Rate</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={filterRange(data.JTSJOL || []).map(p => {
          const qr = (data.JTSQUR || []).find(x => x.d === p.d);
          return { d: p.d, openings: p.v / 1000, quits: qr?.v };
        })} margin={{ top: 5, right: 40, left: -5, bottom: 0 }}>
          <defs>
            <linearGradient id="g-jolts" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.25} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(filterRange(data.JTSJOL || []).length / 8) - 1)} tickFormatter={fmtAxisDate} />
          <YAxis yAxisId="left" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v, n) => [n === "Job Openings" ? `${v.toFixed(1)}M` : `${v.toFixed(1)}%`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Area yAxisId="left" type="monotone" dataKey="openings" name="Job Openings" stroke="#10B981" fill="url(#g-jolts)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          <Area yAxisId="right" type="monotone" dataKey="quits" name="Quits Rate" stroke="#F59E0B" fill="none" strokeWidth={2} dot={false} strokeDasharray="6 3" />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <InfoBox color="#10B981">
      <strong style={{ color: "var(--text-primary)" }}>JOLTS</strong> measures labor demand. High openings + high quits rate = workers feel confident enough to quit for better jobs (tight labor market). Falling openings + falling quits = cooling labor demand.
    </InfoBox>

    {/* Beveridge Curve */}
    {beveridge.length > 5 && (<>
      <SH>Beveridge Curve</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis type="number" dataKey="unemployment" name="Unemployment" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `${v}%`} label={{ value: "Unemployment Rate %", position: "insideBottom", offset: -2, fill: "var(--text-muted)", fontSize: 10, fontFamily: fonts.mono }} />
            <YAxis type="number" dataKey="openings" name="Openings" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickFormatter={v => `${v}M`} label={{ value: "Job Openings (M)", angle: -90, position: "insideLeft", offset: 15, fill: "var(--text-muted)", fontSize: 10, fontFamily: fonts.mono }} />
            <ZAxis range={[20, 20]} />
            <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} formatter={(v, n) => [n === "Unemployment" ? `${v.toFixed(1)}%` : `${v.toFixed(2)}M`, n]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? fmtDate(payload[0].payload.date) : ""} />
            <Scatter data={beveridge} fill="#818cf8" fillOpacity={0.6} strokeWidth={0}>
              {beveridge.map((p, i) => {
                const t = i / Math.max(beveridge.length - 1, 1);
                const r = Math.round(59 + t * 70);
                const g = Math.round(130 - t * 50);
                const b = Math.round(246 - t * 100);
                return <Cell key={i} fill={`rgb(${r},${g},${b})`} fillOpacity={0.3 + t * 0.6} />;
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>◀ Earlier (lighter)</span>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>Recent (darker) ▶</span>
        </div>
      </div>
      <InfoBox color="#818cf8">
        <strong style={{ color: "var(--text-primary)" }}>Beveridge Curve:</strong> Plots job openings vs unemployment. During recoveries the curve shifts up-left (many openings, low unemployment). In recessions it moves down-right. Outward shifts of the whole curve suggest structural mismatch — lots of openings AND high unemployment simultaneously.
      </InfoBox>
    </>)}

    {/* Labor Force Participation */}
    <SH>Labor Force Participation Rate</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={filterRange(data.CIVPART || []).map(p => {
          const prime = (data.LNS11300060 || []).find(x => x.d === p.d);
          return { d: p.d, CIVPART: p.v, PRIME: prime?.v };
        })} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="g-civpart" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366F1" stopOpacity={0.25} /><stop offset="95%" stopColor="#6366F1" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(filterRange(data.CIVPART || []).length / 8) - 1)} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`${v.toFixed(1)}%`]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="PRIME" name="Prime-Age (25-54)" stroke="#14B8A6" fill="none" strokeWidth={2} dot={false} strokeDasharray="6 3" />
          <Area type="monotone" dataKey="CIVPART" name="Total LFPR" stroke="#6366F1" fill="url(#g-civpart)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "var(--text-primary)" }}>Participation Rate</strong> measures what share of the working-age population is in the labor force. Total LFPR is dragged down by aging demographics (Baby Boomer retirement). <strong style={{ color: "var(--text-primary)" }}>Prime-Age (25-54)</strong> strips out demographics and gives a cleaner signal of labor market engagement.
    </InfoBox>

    {/* Average Hourly Earnings YoY */}
    {earningsYoY.length > 0 && (<>
      <SH>Average Hourly Earnings — YoY %</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={earningsYoY} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-earnings" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} /><stop offset="95%" stopColor="#818cf8" stopOpacity={0} /></linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(earningsYoY.length / 8) - 1)} tickFormatter={fmtAxisDate} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`${v.toFixed(1)}%`, "Wage Growth"]} />
            <ReferenceLine y={3.5} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" label={{ value: "Fed comfort zone", fill: "#64748b", fontSize: 9, position: "right" }} />
            <Area type="monotone" dataKey="v" name="Avg Hourly Earnings YoY" stroke="#818cf8" fill="url(#g-earnings)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <InfoBox color="#818cf8">
        <strong style={{ color: "var(--text-primary)" }}>Wage growth</strong> above ~3.5% can fuel inflationary pressure through a wage-price spiral. The Fed watches this closely — strong wage growth makes it harder to cut rates even if headline inflation cools.
      </InfoBox>
    </>)}

    {/* Sahm Rule */}
    <SH>Sahm Rule Recession Indicator</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={filterRange(data.SAHMREALTIME || [])} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="g-sahm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#EF4444" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={Math.max(0, Math.floor(filterRange(data.SAHMREALTIME || []).length / 8) - 1)} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}pp`} domain={[0, "auto"]} />
          <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`${v.toFixed(2)}pp`, "Sahm Rule"]} />
          <ReferenceLine y={0.5} stroke="#EF4444" strokeDasharray="4 4" label={{ value: "0.50 Recession Threshold", fill: "#f87171", fontSize: 9, position: "right" }} />
          <Area type="monotone" dataKey="v" stroke="#EF4444" fill="url(#g-sahm)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <InfoBox color="#EF4444">
      <strong style={{ color: "var(--text-primary)" }}>Sahm Rule:</strong> Triggers when the 3-month moving average of unemployment rises 0.50pp or more above its 12-month low. Has signaled every U.S. recession since 1970 with no false positives. Created by economist Claudia Sahm as a real-time recession indicator.
    </InfoBox>
  </>);
}

export default LaborSubTab;
