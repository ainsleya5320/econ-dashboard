import React, { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, SH, InfoBox } from "../components/shared.jsx";

// ────────────────────────────────────────────────────────────────
// FRED Series Configuration (7 series with formatting rules)
// ────────────────────────────────────────────────────────────────
const SERIES = {
  WALCL: { label: "Total Assets", color: "#818cf8", limit: 520, format: "T" },
  TREAST: { label: "Treasuries Held", color: "#3B82F6", limit: 120, format: "T" },
  MORTGAGE: { label: "MBS Held", color: "#10B981", limit: 120, format: "T" },
  EXCRESBA: { label: "Excess Reserves", color: "#F59E0B", limit: 120, format: "B" },
  WIMFSL: { label: "Total Liabilities", color: "#EF4444", limit: 520, format: "T" },
  MMNRNJ: { label: "Money Market Holdings", color: "#8B5CF6", limit: 520, format: "B" },
  DMONRNJ: { label: "Deposits (Technical)", color: "#EC4899", limit: 1000, format: "B" },
};

// Batch size for FRED API requests (respect rate limits)
const BATCH = 3;

// ────────────────────────────────────────────────────────────────
// Smart Number Formatter
// ────────────────────────────────────────────────────────────────
const fmtNum = (val, preferredFormat) => {
  if (val == null) return null;
  if (preferredFormat === "B") return `$${(val / 1).toFixed(0)}B`;
  if (preferredFormat === "T") return `$${(val / 1000).toFixed(2)}T`;
  // Smart: use T for large values, B for small
  return val >= 100 ? `$${(val / 1000).toFixed(2)}T` : `$${(val / 1).toFixed(0)}B`;
};

// ────────────────────────────────────────────────────────────────
// Data Merging Function (forward-fill for different frequencies)
// ────────────────────────────────────────────────────────────────
const mergeByDate = (dataObj, seriesIds, fieldNames = {}) => {
  // Collect all unique dates
  const allDates = new Set();
  seriesIds.forEach(id => {
    if (dataObj[id]) {
      dataObj[id].forEach(obs => allDates.add(obs.d));
    }
  });

  const sorted = Array.from(allDates).sort();
  const merged = [];

  // Maintain current value for each series (forward-fill)
  const current = {};
  seriesIds.forEach(id => { current[id] = null; });

  sorted.forEach(date => {
    // Update current values from this date's observations
    seriesIds.forEach(id => {
      const obs = dataObj[id]?.find(o => o.d === date);
      if (obs) current[id] = obs.v;
    });

    // Only include if we have at least one value
    if (Object.values(current).some(v => v !== null)) {
      const row = { d: date };
      seriesIds.forEach(id => {
        row[fieldNames[id] || id] = current[id];
      });
      merged.push(row);
    }
  });

  return merged;
};

// ────────────────────────────────────────────────────────────────
// Main FedSubTab Component
// ────────────────────────────────────────────────────────────────
function FedSubTab({ fredKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Fetch FRED data in batches
  useEffect(() => {
    if (!fredKey || data) return;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const result = {};
        const entries = Object.entries(SERIES);

        for (let b = 0; b < entries.length; b += BATCH) {
          const batch = entries.slice(b, b + BATCH);

          const fetched = await Promise.all(
            batch.map(async ([id, meta]) => {
              try {
                const obs = await fetchFred(id, fredKey, meta.limit);
                return [id, obs];
              } catch (e) {
                console.warn(`Failed to fetch ${id}:`, e.message);
                return [id, []];
              }
            })
          );

          fetched.forEach(([id, obs]) => {
            result[id] = obs;
          });

          // Stagger requests to avoid hitting FRED rate limits
          if (b + BATCH < entries.length) {
            await new Promise(r => setTimeout(r, 400));
          }
        }

        setData(result);
        setLoading(false);
      } catch (e) {
        console.error("Error fetching Fed data:", e);
        setError(true);
        setLoading(false);
      }
    })();
  }, [fredKey, data]);

  // Helper to get latest value for a series
  const latest = (id) => {
    const arr = data?.[id];
    return arr?.length ? arr[arr.length - 1] : null;
  };

  // Prepare merged data for composition chart (TREAST, MORTGAGE, MMNRNJ)
  const compositionData = useMemo(() => {
    if (!data || !data.TREAST || !data.MORTGAGE || !data.MMNRNJ) return null;
    return mergeByDate(data, ["TREAST", "MORTGAGE", "MMNRNJ"], {
      TREAST: "treasuries",
      MORTGAGE: "mbs",
      MMNRNJ: "moneyMkt",
    });
  }, [data]);

  // Prepare merged data for operational chart (EXCRESBA, DMONRNJ, WIMFSL)
  const operationalData = useMemo(() => {
    if (!data || !data.EXCRESBA || !data.DMONRNJ || !data.WIMFSL) return null;
    return mergeByDate(data, ["EXCRESBA", "DMONRNJ", "WIMFSL"], {
      EXCRESBA: "excesses",
      DMONRNJ: "deposits",
      WIMFSL: "liabilities",
    });
  }, [data]);

  return (
    <>
      <SH>Federal Reserve Balance Sheet</SH>
      <InfoBox color="#818cf8">
        Federal Reserve balance sheet size and composition. Track Fed policy actions through asset holdings and operational metrics. Data from FRED (weekly assets, monthly details).
      </InfoBox>

      {/* Loading state */}
      {loading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", padding: "20px" }}>
          ⏳ Loading Fed balance sheet data...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ color: "#ef4444", fontSize: 13, padding: "12px 14px", background: "#ef44440a", border: "1px solid #ef444422", borderRadius: 8, marginBottom: 14 }}>
          ⚠️ Failed to load Fed data. Please try refreshing.
        </div>
      )}

      {/* Metric cards grid (7 series) */}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10, marginBottom: 20 }}>
            {Object.entries(SERIES).map(([id, s]) => {
              const val = latest(id);
              const displayVal = val ? (val.v / 1000) : null; // Convert millions to billions for display
              const displayStr = fmtNum(displayVal, s.format);

              return (
                <div key={id} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: s.color, borderRadius: "14px 14px 0 0" }} />
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>
                    {displayStr || "—"}
                  </div>
                  {val && (
                    <div style={{ fontSize: 9, color: "#4ade80", marginTop: 3, fontFamily: fonts.mono }}>
                      {fmtDate(val.d)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Total Assets Chart */}
          {data.WALCL && data.WALCL.length > 0 && (
            <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 20 }}>
              <h3 style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 10px 12px" }}>
                Total Assets (Weekly)
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={data.WALCL} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="walclGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}T`} />
                  <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`$${(v / 1000).toFixed(2)}T`, "Assets"]} />
                  <Area type="monotone" dataKey="v" stroke="#818cf8" fill="url(#walclGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Asset Composition Chart (Stacked) */}
          {compositionData && compositionData.length > 0 && (
            <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 20 }}>
              <h3 style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 10px 12px" }}>
                Asset Composition (Stacked)
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={compositionData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="treasGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="mbsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="mmGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}T`} />
                  <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`$${(v / 1000).toFixed(2)}T`, ""]} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
                  <Area type="monotone" dataKey="treasuries" stackId="1" name="Treasuries" stroke="#3B82F6" fill="url(#treasGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="mbs" stackId="1" name="MBS" stroke="#10B981" fill="url(#mbsGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="moneyMkt" stackId="1" name="Money Market" stroke="#F59E0B" fill="url(#mmGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Operational Metrics Chart (Lines, in Billions) */}
          {operationalData && operationalData.length > 0 && (
            <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
              <h3 style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 10px 12px" }}>
                Operational Metrics (Billions)
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={operationalData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}B`} />
                  <Tooltip contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelFormatter={fmtDate} formatter={(v) => [`$${v.toFixed(0)}B`, ""]} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
                  <Line type="monotone" dataKey="excesses" name="Excess Reserves" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="deposits" name="Deposits (Technical)" stroke="#EC4899" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="liabilities" name="Total Liabilities" stroke="#EF4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default FedSubTab;
