import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

/* ── Tracked CFTC contracts ─────────────────────────────────────── */
const CONTRACTS = [
  { code: '067651', label: 'WTI Crude',   group: 'Energy',      color: '#E8553A' },
  { code: '03565B', label: 'Natural Gas',  group: 'Energy',      color: '#3B82F6' },
  { code: '088691', label: 'Gold',         group: 'Metals',      color: '#F59E0B' },
  { code: '084691', label: 'Silver',       group: 'Metals',      color: '#94a3b8' },
  { code: '085692', label: 'Copper',       group: 'Metals',      color: '#F97316' },
  { code: '002602', label: 'Corn',         group: 'Agriculture', color: '#EAB308' },
  { code: '001602', label: 'Wheat',        group: 'Agriculture', color: '#D97706' },
  { code: '005602', label: 'Soybeans',     group: 'Agriculture', color: '#10B981' },
  { code: '13874A', label: 'S&P 500',      group: 'Financial',   color: '#6366F1' },
  { code: '098662', label: 'USD Index',    group: 'Financial',   color: '#22D3EE' },
  { code: '043602', label: '10Y T-Note',   group: 'Financial',   color: '#8B5CF6' },
  { code: '099741', label: 'Euro FX',      group: 'Financial',   color: '#EC4899' },
];
const GROUPS = ['Energy', 'Metals', 'Agriculture', 'Financial'];
const RANGE_OPTS = [
  { label: '1Y', weeks: 52 },
  { label: '3Y', weeks: 156 },
  { label: '5Y', weeks: 260 },
];
const CODE_MAP = Object.fromEntries(CONTRACTS.map(c => [c.code, c]));

/* ── helpers ────────────────────────────────────────────────────── */
const fmtK = (v) => {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
};
const fmtPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtDate = (d) => {
  const p = d.split('-');
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1];
  return `${mn} ${+p[2]}, ${p[0]}`;
};
const fmtAxisDate = (d) => {
  const p = d.split('-');
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1];
  return `${mn} '${p[0].slice(2)}`;
};

/* ── Summary row ────────────────────────────────────────────────── */
function SummaryRow({ contract, current, prev }) {
  if (!current) return null;
  const specNet = current.specLong - current.specShort;
  const commNet = current.commLong - current.commShort;
  const specPct = current.oi > 0 ? (specNet / current.oi) * 100 : 0;
  const prevSpecNet = prev ? prev.specLong - prev.specShort : null;
  const wowChange = prevSpecNet != null ? specNet - prevSpecNet : null;
  const isLong = specNet > 0;
  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: '8px 10px', fontSize: 12, fontFamily: fonts.heading, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: contract.color, marginRight: 8 }} />
        {contract.label}
      </td>
      <td style={{ padding: '8px 6px', fontSize: 11, fontFamily: fonts.mono, color: 'var(--text-secondary)', textAlign: 'right' }}>
        {fmtK(current.oi)}
      </td>
      <td style={{ padding: '8px 6px', fontSize: 11, fontFamily: fonts.mono, textAlign: 'right', fontWeight: 600, color: isLong ? '#4ade80' : '#f87171' }}>
        {specNet > 0 ? '+' : ''}{fmtK(specNet)}
      </td>
      <td style={{ padding: '8px 6px', fontSize: 11, fontFamily: fonts.mono, textAlign: 'right', color: isLong ? '#4ade80' : '#f87171' }}>
        {fmtPct(specPct)}
      </td>
      <td style={{ padding: '8px 6px', fontSize: 11, fontFamily: fonts.mono, textAlign: 'right', color: commNet > 0 ? '#4ade80' : '#f87171' }}>
        {commNet > 0 ? '+' : ''}{fmtK(commNet)}
      </td>
      <td style={{ padding: '8px 6px', fontSize: 11, fontFamily: fonts.mono, textAlign: 'right', color: wowChange > 0 ? '#4ade80' : wowChange < 0 ? '#f87171' : 'var(--text-muted)' }}>
        {wowChange != null ? `${wowChange > 0 ? '+' : ''}${fmtK(wowChange)}` : '—'}
      </td>
    </tr>
  );
}

/* ── Group net positioning chart ────────────────────────────────── */
function GroupChart({ group, data, contracts, height = 220 }) {
  const groupContracts = contracts.filter(c => c.group === group);
  if (!groupContracts.length) return null;
  // Merge all contract histories into chart data
  const dateMap = {};
  for (const c of groupContracts) {
    const hist = data[c.code];
    if (!hist) continue;
    for (const row of hist) {
      if (!dateMap[row.date]) dateMap[row.date] = { d: row.date };
      dateMap[row.date][c.code] = row.oi > 0 ? ((row.specLong - row.specShort) / row.oi) * 100 : 0;
    }
  }
  const chartData = Object.values(dateMap).sort((a, b) => a.d.localeCompare(b.d));
  if (!chartData.length) return null;
  const tickInt = Math.max(0, Math.floor(chartData.length / 7) - 1);
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: '16px 16px 8px 6px', marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10, paddingLeft: 12 }}>
        {group} — Net Speculator Position (% of Open Interest)
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            {groupContracts.map(c => (
              <linearGradient key={c.code} id={`cftc-${c.code}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={c.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={c.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <XAxis dataKey="d" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false} interval={tickInt} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={v => `${v.toFixed(0)}%`} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ background: 'var(--tooltip-bg, #0f172a)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }}
            labelStyle={{ color: 'var(--text-secondary)' }}
            labelFormatter={fmtDate}
            formatter={(v, name) => {
              const c = CODE_MAP[name];
              return [`${v.toFixed(1)}%`, c ? c.label : name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7}
            formatter={(val) => CODE_MAP[val]?.label || val} />
          {groupContracts.map(c => (
            <Area key={c.code} type="monotone" dataKey={c.code} name={c.code} stroke={c.color} fill={`url(#cftc-${c.code})`} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────── */
export default function CftcSubTab() {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('1Y');

  useEffect(() => {
    const codes = CONTRACTS.map(c => `'${c.code}'`).join(',');
    const fields = [
      'report_date_as_yyyy_mm_dd', 'cftc_contract_market_code',
      'open_interest_all', 'noncomm_positions_long_all', 'noncomm_positions_short_all',
      'comm_positions_long_all', 'comm_positions_short_all',
      'nonrept_positions_long_all', 'nonrept_positions_short_all',
    ].join(',');
    const since = new Date();
    since.setFullYear(since.getFullYear() - 5);
    const sinceStr = since.toISOString().slice(0, 10);
    const url = `/cftc-api/jun7-fc8e.json?$where=cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd>'${sinceStr}'&$select=${fields}&$order=report_date_as_yyyy_mm_dd DESC&$limit=5000`;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`CFTC API ${r.status}`); return r.json(); })
      .then(rows => {
        const byCode = {};
        for (const row of rows) {
          const code = row.cftc_contract_market_code;
          if (!byCode[code]) byCode[code] = [];
          byCode[code].push({
            date: row.report_date_as_yyyy_mm_dd.slice(0, 10),
            oi: +row.open_interest_all || 0,
            specLong: +row.noncomm_positions_long_all || 0,
            specShort: +row.noncomm_positions_short_all || 0,
            commLong: +row.comm_positions_long_all || 0,
            commShort: +row.comm_positions_short_all || 0,
            smallLong: +row.nonrept_positions_long_all || 0,
            smallShort: +row.nonrept_positions_short_all || 0,
          });
        }
        for (const code of Object.keys(byCode)) {
          byCode[code].sort((a, b) => a.date.localeCompare(b.date));
        }
        setRawData(byCode);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  /* Filter by range */
  const data = useMemo(() => {
    if (!rawData) return null;
    const r = RANGE_OPTS.find(o => o.label === range);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (r ? r.weeks * 7 : 365));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const filtered = {};
    for (const [code, rows] of Object.entries(rawData)) {
      filtered[code] = rows.filter(r => r.date >= cutoffStr);
    }
    return filtered;
  }, [rawData, range]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: fonts.mono, fontSize: 12 }}>Loading CFTC Commitment of Traders data...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontFamily: fonts.mono, fontSize: 12 }}>Error: {error}</div>;
  if (!data) return null;

  /* Get current and previous week for each contract */
  const getCurrent = (code) => {
    const rows = rawData[code];
    return rows?.length ? rows[rows.length - 1] : null;
  };
  const getPrev = (code) => {
    const rows = rawData[code];
    return rows?.length > 1 ? rows[rows.length - 2] : null;
  };

  const activeContracts = CONTRACTS.filter(c => rawData[c.code]?.length > 0);
  const latestDate = activeContracts.length
    ? activeContracts.reduce((best, c) => {
        const d = getCurrent(c.code)?.date;
        return d && d > best ? d : best;
      }, '')
    : '';

  return (
    <>
      {/* Range toggle */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-subtle)', borderRadius: 8, padding: 3, marginBottom: 16, width: 'fit-content' }}>
        {RANGE_OPTS.map(o => (
          <button key={o.label} onClick={() => setRange(o.label)} style={{
            padding: '5px 14px', border: 'none', borderRadius: 6,
            background: range === o.label ? 'var(--tab-active-bg)' : 'transparent',
            color: range === o.label ? 'var(--tab-active-color)' : 'var(--tab-inactive-color)',
            fontSize: 11, fontWeight: range === o.label ? 600 : 400,
            fontFamily: fonts.mono, cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: range === o.label ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
          }}>{o.label}</button>
        ))}
      </div>

      {/* Summary table */}
      <SH>Current Positioning{latestDate ? ` — Week of ${fmtDate(latestDate)}` : ''}</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border-subtle)' }}>
              {['Contract', 'Open Interest', 'Spec Net', 'Spec %OI', 'Comm Net', '1-Wk Chg'].map(h => (
                <th key={h} style={{ padding: '10px 6px', fontSize: 10, fontFamily: fonts.mono, color: 'var(--text-muted)', textAlign: h === 'Contract' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 500 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(group => {
              const groupContracts = activeContracts.filter(c => c.group === group);
              if (!groupContracts.length) return null;
              return (
                <React.Fragment key={group}>
                  <tr><td colSpan={6} style={{ padding: '10px 10px 4px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', fontFamily: fonts.heading, textTransform: 'uppercase', letterSpacing: 0.8, background: 'var(--bg-subtle)' }}>{group}</td></tr>
                  {groupContracts.map(c => (
                    <SummaryRow key={c.code} contract={c} current={getCurrent(c.code)} prev={getPrev(c.code)} />
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Net positioning charts by group */}
      <SH>Net Speculator Positioning Over Time</SH>
      {GROUPS.map(g => (
        <GroupChart key={g} group={g} data={data} contracts={activeContracts} />
      ))}

      <InfoBox color="#6366F1">
        <strong style={{ color: 'var(--text-primary)' }}>Commitment of Traders (COT)</strong> reports are published weekly by the CFTC. They break down futures positioning into three categories: <strong style={{ color: '#4ade80' }}>Speculators</strong> (hedge funds, managed money — trend followers), <strong style={{ color: '#F59E0B' }}>Commercials</strong> (producers/consumers hedging real exposure — often contrarian), and <strong style={{ color: '#94a3b8' }}>Small Traders</strong> (retail). Extreme speculator positioning often signals crowded trades. When specs are heavily net long, it can indicate bullish consensus (and potential reversal risk). Data: CFTC Legacy Combined report.
      </InfoBox>
    </>
  );
}
