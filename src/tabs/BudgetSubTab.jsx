import React, { useState, useEffect, useMemo } from "react";
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import { fetchFred } from "../lib/api.js";

const Plot = createPlotlyComponent(Plotly);

const FISCAL_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
const AVAILABLE_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

/* ── colour palettes ─────────────────────────────────────────── */
const REV_COLORS   = ['#818cf8','#6366f1','#a78bfa','#c084fc','#e879f9','#f0abfc','#94a3b8'];
const SPEND_COLORS = ['#f87171','#fb923c','#fbbf24','#facc15','#4ade80','#34d399',
                      '#2dd4bf','#38bdf8','#60a5fa','#a78bfa','#f472b6','#94a3b8'];

/* ── Treasury fetch (Table 9 has everything) ──────────────────── */
async function fetchTable9(year) {
  try {
    const url = `${FISCAL_BASE}/v1/accounting/mts/mts_table_9` +
      `?filter=record_fiscal_year:eq:${year},record_calendar_month:eq:09` +
      `&page[size]=100&sort=line_code_nbr`;
    const resp = await fetch(url);
    const json = await resp.json();
    return json?.data || [];
  } catch { return []; }
}

/* ── Format full-dollar values ───────────────────────────────── */
function fmtD(val) {
  if (val == null || isNaN(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(0)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

/* ── Shorten long category names for Sankey ───────────────────── */
const SHORT = {
  'Social Insurance & Retirement':                       'Payroll / Social Ins.',
  'Education, Training, Employment, and Social Services': 'Education & Training',
  'Veterans Benefits and Services':                       'Veterans Benefits',
  'Administration of Justice':                            'Justice',
  'Community and Regional Development':                   'Community Dev.',
  'Natural Resources and Environment':                    'Natural Resources',
  'General Science, Space, and Technology':                'Science & Space',
  'Commerce and Housing Credit':                          'Commerce & Housing',
};
const shorten = n => SHORT[n] || n;

/* ═════════════════════════════════════════════════════════════ */
function BudgetSubTab({ fredKey }) {
  const [selectedYear, setSelectedYear] = useState(2024);
  const [rawData,   setRawData]   = useState(null);
  const [histData,  setHistData]  = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [histRange, setHistRange] = useState('30y');

  const isDark = useMemo(() => {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--page-bg').trim();
    return !bg.startsWith('#f');
  }, []);

  /* ── Fetch Table 9 when year changes ─────────────────────── */
  useEffect(() => {
    setLoading(true);
    setRawData(null);
    fetchTable9(selectedYear).then(d => {
      setRawData(d);
      setLoading(false);
    });
  }, [selectedYear]);

  /* ── Fetch FRED historical (once) ────────────────────────── */
  useEffect(() => {
    if (!fredKey || histData) return;
    Promise.all([
      fetchFred('FYFSGDA188S', fredKey, 100),
      fetchFred('FYFRGDA188S', fredKey, 100),
      fetchFred('FYONGDA188S', fredKey, 100),
    ]).then(([def, rec, out]) => {
      const map = {};
      rec.forEach(({ d, v }) => { if (v != null) map[d] = { ...map[d], d, rec: v }; });
      out.forEach(({ d, v }) => { if (v != null) map[d] = { ...map[d], d, out: v }; });
      def.forEach(({ d, v }) => { if (v != null) map[d] = { ...map[d], d, def: v }; });
      setHistData(
        Object.values(map)
          .filter(x => x.rec != null || x.out != null)
          .sort((a, b) => a.d.localeCompare(b.d))
      );
    }).catch(() => {});
  }, [fredKey, histData]);

  /* ──────────────────────────────────────────────────────────
     Parse Table 9 into receipt + outlay categories.
     Table 9 layout (by line_code_nbr):
       10       Receipts  (header, lvl 1, null amt)
       20–110   receipt items  (lvl 2, some have children at lvl 3)
       120      Total Receipts
       130      Net Outlays  (header, lvl 1, null amt)
       140–330  outlay items  (lvl 2)
       340      Total Outlays
     "Social Insurance …" (line 40) is lvl-2 header with null amt;
     its children (lines 50-70, lvl 3) carry the actual amounts.
  ────────────────────────────────────────────────────────────── */

  const receiptCategories = useMemo(() => {
    if (!rawData?.length) return [];
    const rows = rawData.filter(r => {
      const lc = parseInt(r.line_code_nbr);
      return lc > 10 && lc < 120;           // receipt section, skip header + total
    });

    // Collect level-2 items with non-null amounts
    const cats = [];
    rows.forEach(r => {
      const lvl = parseInt(r.sequence_level_nbr);
      const amt = parseFloat(r.current_fytd_rcpt_outly_amt);
      const desc = r.classification_desc || '';
      if (lvl === 2 && !isNaN(amt) && amt > 0) {
        cats.push({ name: desc, value: amt });
      }
    });

    // Aggregate level-3 children of "Social Insurance …" into one entry
    const lvl3 = rows.filter(r => parseInt(r.sequence_level_nbr) === 3);
    if (lvl3.length) {
      const sum = lvl3.reduce(
        (s, r) => s + (parseFloat(r.current_fytd_rcpt_outly_amt) || 0), 0);
      if (sum > 0) cats.push({ name: 'Social Insurance & Retirement', value: sum });
    }

    return cats.sort((a, b) => b.value - a.value);
  }, [rawData]);

  const outlayCategories = useMemo(() => {
    if (!rawData?.length) return [];
    return rawData
      .filter(r => {
        const lc   = parseInt(r.line_code_nbr);
        const lvl  = parseInt(r.sequence_level_nbr);
        const amt  = parseFloat(r.current_fytd_rcpt_outly_amt);
        const desc = (r.classification_desc || '').toLowerCase();
        return lc >= 140 && lc < 340
          && lvl === 2
          && !isNaN(amt) && amt > 0
          && !desc.includes('total')
          && !desc.includes('undistributed');
      })
      .map(r => ({
        name:  r.classification_desc,
        value: parseFloat(r.current_fytd_rcpt_outly_amt),
      }))
      .sort((a, b) => b.value - a.value);
  }, [rawData]);

  const totalReceipts = useMemo(() =>
    receiptCategories.reduce((s, r) => s + r.value, 0), [receiptCategories]);
  const totalOutlays = useMemo(() =>
    outlayCategories.reduce((s, r) => s + r.value, 0), [outlayCategories]);
  const deficit = totalOutlays - totalReceipts;

  /* ── Latest FRED deficit-% value ──────────────────────────── */
  const latestDef = useMemo(() => {
    if (!histData?.length) return null;
    const r = [...histData].reverse().find(d => d.def != null);
    return r ? { v: r.def, year: r.d.slice(0, 4) } : null;
  }, [histData]);

  /* ── Build Sankey ──────────────────────────────────────────── */
  const sankeyData = useMemo(() => {
    if (!receiptCategories.length || !outlayCategories.length) return null;

    const nRev      = receiptCategories.length;
    const centerIdx = nRev;                         // "Federal Budget" node
    const hasDef    = deficit > 1e9;                 // >$1 B
    const defIdx    = nRev + 1 + outlayCategories.length;

    const labels = [
      ...receiptCategories.map(r => shorten(r.name)),
      'Federal\nBudget',
      ...outlayCategories.map(o => shorten(o.name)),
      ...(hasDef ? ['Deficit\n(Borrowing)'] : []),
    ];
    const nodeColors = [
      ...receiptCategories.map((_, i) => REV_COLORS[i % REV_COLORS.length]),
      isDark ? '#475569' : '#94a3b8',
      ...outlayCategories.map((_, i) => SPEND_COLORS[i % SPEND_COLORS.length]),
      ...(hasDef ? ['#ef4444'] : []),
    ];

    const src = [], tgt = [], val = [], col = [];

    // Revenue → Budget
    receiptCategories.forEach((r, i) => {
      src.push(i); tgt.push(centerIdx);
      val.push(r.value / 1e9);                      // $ → $B
      col.push(`${REV_COLORS[i % REV_COLORS.length]}66`);
    });
    // Deficit → Budget
    if (hasDef) {
      src.push(defIdx); tgt.push(centerIdx);
      val.push(deficit / 1e9);
      col.push('#ef444455');
    }
    // Budget → Spending
    outlayCategories.forEach((o, i) => {
      src.push(centerIdx); tgt.push(centerIdx + 1 + i);
      val.push(o.value / 1e9);
      col.push(`${SPEND_COLORS[i % SPEND_COLORS.length]}55`);
    });

    return { labels, nodeColors, src, tgt, val, col };
  }, [receiptCategories, outlayCategories, deficit, isDark]);

  /* ── Filtered hist data ────────────────────────────────────── */
  const filteredHist = useMemo(() => {
    if (!histData) return [];
    const now = new Date().getFullYear();
    const cut = histRange === '10y' ? `${now - 10}-01-01`
              : histRange === '30y' ? `${now - 30}-01-01`
              : '1900-01-01';
    return histData.filter(d => d.d >= cut);
  }, [histData, histRange]);

  const fontColor = isDark ? '#94a3b8' : '#64748b';

  /* ── Summary tiles ─────────────────────────────────────────── */
  const tiles = [
    { label: 'Total Revenue', value: totalReceipts ? fmtD(totalReceipts) : '—',
      color: '#4ade80', sub: `FY${selectedYear}` },
    { label: 'Total Outlays',  value: totalOutlays ? fmtD(totalOutlays) : '—',
      color: '#f87171', sub: `FY${selectedYear}` },
    { label: deficit > 0 ? 'Budget Deficit' : 'Budget Surplus',
      value: (totalReceipts && totalOutlays) ? fmtD(Math.abs(deficit)) : '—',
      color: deficit > 0 ? '#ef4444' : '#4ade80',
      sub: deficit > 0 ? 'Annual borrowing' : 'Annual surplus' },
    { label: 'Deficit % GDP',
      value: latestDef ? `${latestDef.v > 0 ? '+' : ''}${latestDef.v.toFixed(1)}%` : '—',
      color: (latestDef?.v ?? 0) < 0 ? '#f87171' : '#4ade80',
      sub: latestDef ? `FY${latestDef.year} · negative = deficit` : 'FRED' },
  ];

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div>
      <InfoBox color="#818cf8">
        Federal budget data from the U.S. Treasury Monthly Treasury Statement (MTS Table 9).
        Fiscal year runs Oct 1 – Sep 30; end-of-year cumulative figures shown.
        Historical % of GDP via FRED.
      </InfoBox>

      {/* Year selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: fonts.mono }}>
          Fiscal Year:
        </span>
        {AVAILABLE_YEARS.map(y => (
          <button key={y} onClick={() => setSelectedYear(y)} style={{
            padding: '5px 13px', borderRadius: 8, cursor: 'pointer',
            border: selectedYear === y ? '1px solid #818cf8' : '1px solid var(--border-subtle)',
            background: selectedYear === y ? 'rgba(129,140,248,0.15)' : 'transparent',
            color: selectedYear === y ? '#c7d2fe' : 'var(--text-muted)',
            fontSize: 11, fontFamily: fonts.mono, fontWeight: selectedYear === y ? 600 : 400,
          }}>FY{y}</button>
        ))}
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {tiles.map((t, i) => (
          <div key={i} style={{
            background: cardBg, border: cardBorder, borderRadius: 14,
            padding: '14px 16px', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3,
              background: t.color, borderRadius: '14px 14px 0 0' }} />
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: fonts.mono,
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
              fontFamily: fonts.heading }}>
              {loading ? '...' : t.value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: fonts.mono,
              marginTop: 2 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14,
          padding: 40, textAlign: 'center', color: 'var(--text-muted)',
          fontFamily: fonts.mono, fontSize: 12, marginBottom: 18 }}>
          Loading Treasury data…
        </div>
      )}

      {/* Sankey diagram */}
      {sankeyData && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14,
          padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fonts.mono,
            letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
            FY{selectedYear} Budget Flow — Revenue → Spending ($ Billions)
          </div>
          <Plot
            data={[{
              type: 'sankey', orientation: 'h',
              node: {
                pad: 14, thickness: 18,
                line: { color: 'rgba(0,0,0,0)', width: 0 },
                label: sankeyData.labels,
                color: sankeyData.nodeColors,
                hovertemplate: '<b>%{label}</b><br>$%{value:.1f}B<extra></extra>',
              },
              link: {
                source: sankeyData.src, target: sankeyData.tgt,
                value: sankeyData.val, color: sankeyData.col,
                hovertemplate:
                  '%{source.label} → %{target.label}<br><b>$%{value:.1f}B</b><extra></extra>',
              },
            }]}
            layout={{
              height: 600,
              margin: { t: 10, b: 10, l: 10, r: 10 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font: { family: fonts.heading, size: 10, color: fontColor },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Revenue & Spending breakdown */}
      {(receiptCategories.length > 0 || outlayCategories.length > 0) && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
          {/* Revenue by source */}
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fonts.mono,
              letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 14 }}>
              Revenue by Source
            </div>
            {receiptCategories.map((r, i) => {
              const pct = totalReceipts > 0 ? (r.value / totalReceipts * 100) : 0;
              return (
                <div key={r.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)',
                      fontFamily: fonts.heading, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)',
                      fontFamily: fonts.mono, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {fmtD(r.value)}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)',
                      fontFamily: fonts.mono, width: 32, textAlign: 'right' }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-subtle)' }}>
                    <div style={{ height: '100%', width: `${pct}%`,
                      background: REV_COLORS[i % REV_COLORS.length],
                      borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Outlays by function */}
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fonts.mono,
              letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 14 }}>
              Outlays by Budget Function
            </div>
            {outlayCategories.map((o, i) => {
              const pct = totalOutlays > 0 ? (o.value / totalOutlays * 100) : 0;
              return (
                <div key={o.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)',
                      fontFamily: fonts.heading, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)',
                      fontFamily: fonts.mono, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {fmtD(o.value)}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)',
                      fontFamily: fonts.mono, width: 32, textAlign: 'right' }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-subtle)' }}>
                    <div style={{ height: '100%', width: `${pct}%`,
                      background: SPEND_COLORS[i % SPEND_COLORS.length],
                      borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical % of GDP chart */}
      {filteredHist.length > 0 && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14,
          padding: '16px 16px 8px 6px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 12, paddingLeft: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fonts.mono,
              letterSpacing: 0.5, textTransform: 'uppercase', flex: 1 }}>
              Historical Receipts, Outlays &amp; Surplus/Deficit — % of GDP
            </span>
            {['10y', '30y', 'max'].map(r => (
              <button key={r} onClick={() => setHistRange(r)} style={{
                padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                border:     histRange === r ? '1px solid #818cf8' : '1px solid var(--border-subtle)',
                background: histRange === r ? 'rgba(129,140,248,0.15)' : 'transparent',
                color:      histRange === r ? '#c7d2fe' : 'var(--text-muted)',
                fontSize: 10, fontFamily: fonts.mono,
              }}>{r.toUpperCase()}</button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={filteredHist} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="bgRec" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4ade80" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bgOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d"
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: fonts.mono }}
                axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false}
                tickFormatter={d => d.slice(0, 4)}
                interval={filteredHist.length > 20 ? 4 : 1} />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: fonts.mono }}
                axisLine={false} tickLine={false}
                tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={{ background: 'var(--tooltip-bg, #0f172a)',
                  border: '1px solid var(--border-subtle)', borderRadius: 8,
                  fontSize: 11, fontFamily: fonts.heading }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                labelFormatter={d => `FY${d.slice(0, 4)}`}
                formatter={(v, n) => [`${v.toFixed(1)}%`, n]} />
              <ReferenceLine y={0} stroke="var(--border-subtle)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="rec" name="Receipts"
                stroke="#4ade80" fill="url(#bgRec)" strokeWidth={2}
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
              <Area type="monotone" dataKey="out" name="Outlays"
                stroke="#f87171" fill="url(#bgOut)" strokeWidth={2}
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
              <Area type="monotone" dataKey="def" name="Surplus / Deficit"
                stroke="#fbbf24" fill="none" strokeWidth={1.5} strokeDasharray="5 3"
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ paddingLeft: 12, marginTop: 6, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {[
              { c: '#4ade80', l: 'Receipts % GDP' },
              { c: '#f87171', l: 'Outlays % GDP' },
              { c: '#fbbf24', l: 'Surplus / Deficit % GDP (positive = surplus)' },
            ].map(({ c, l }) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: fonts.mono }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default BudgetSubTab;
