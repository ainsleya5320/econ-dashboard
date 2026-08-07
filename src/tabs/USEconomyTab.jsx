import React, { useState, useEffect, useMemo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CHOROPLETH_METRICS, choroplethColor, STATE_FIPS, STATE_NAMES, FIPS_TO_STATE, US_TOPO_URL } from "../lib/constants.js";
import { fetchFMP } from "../lib/api.js";
import { fmtDate, SH, InfoBox } from "../components/shared.jsx";
import RatesTab from "./RatesTab.jsx";
import CpiTab from "./CpiTab.jsx";
import HousingSubTab from "./HousingSubTab.jsx";
import ConsumerTab from "./ConsumerTab.jsx";
import GdpSubTab from "./GdpSubTab.jsx";
import BudgetSubTab from "./BudgetSubTab.jsx";
import LaborSubTab from "./LaborSubTab.jsx";
import FedSubTab from "./FedSubTab.jsx";
import MacroDashboardSubTab from "./MacroDashboardSubTab.jsx";
import DebtMarketTab from "./DebtMarketTab.jsx";
import BankCreditTab from "./BankCreditTab.jsx";
import ProfitsEngineTab from "./ProfitsEngineTab.jsx";

function USEconomyTab({ md, td, gd, cd, csm, hd, zillowData, fredKey, fmpKey, choroplethCache, choroplethMetric, setChoroplethMetric, fetchChoroplethData, choroplethLoading, choroplethProgress }) {
  const [econSubTab, setEconSubTab] = useState("dashboard");
  const [tooltipContent, setTooltipContent] = useState("");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [tableSortCol, setTableSortCol] = useState("rank");
  const [tableSortAsc, setTableSortAsc] = useState(true);
  const [gdpData, setGdpData] = useState(null);

  // Auto-fetch when metric changes
  useEffect(() => { fetchChoroplethData(choroplethMetric); }, [choroplethMetric, fetchChoroplethData]);

  // Fetch economic data from FMP when GDP sub-tab first selected
  useEffect(() => {
    if (econSubTab !== "gdp" || gdpData || !fmpKey) return;
    const longFrom = new Date(Date.now() - 365 * 20 * 86400000).toISOString().slice(0, 10);
    const shortFrom = new Date(Date.now() - 365 * 5 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const ei = (name, from) => fetchFMP(`/economic-indicators?name=${name}&from=${from}&to=${to}`, fmpKey).catch(() => []);
    Promise.all([
      ei("GDP", longFrom),
      ei("realGDP", longFrom),
      ei("realGDPPerCapita", longFrom),
      ei("unemploymentRate", shortFrom),
      ei("initialClaims", shortFrom),
      ei("retailSales", shortFrom),
      ei("industrialProductionTotalIndex", shortFrom),
      ei("consumerSentiment", shortFrom),
      ei("durableGoods", shortFrom),
    ]).then(([gdp, real, perCap, unemployment, initialClaims, retailSales, industrialProd, sentiment, durableGoods]) =>
      setGdpData({ gdp, real, perCap, unemployment, initialClaims, retailSales, industrialProd, sentiment, durableGoods })
    );
  }, [econSubTab, gdpData, fmpKey]);

  const ECON_SUB_TABS = [
    { id: "dashboard",  label: "Dashboard"           },
    { id: "rates",      label: "Rates"               },
    { id: "debt",       label: "Debt & Credit"       },
    { id: "banks",      label: "Bank Credit"         },
    { id: "profits",    label: "Profits Engine"      },
    { id: "fed",        label: "Fed Balance Sheet"   },
    { id: "gdp",        label: "GDP"                 },
    { id: "housing",    label: "Housing"             },
    { id: "cpi",        label: "CPI"                 },
    { id: "stateLevel", label: "State-Level"         },
    { id: "consumer",   label: "Consumer"            },
    { id: "budget",     label: "Fed. Budget"         },
    { id: "labor",      label: "Labor"               },
  ];

  const metricCfg = CHOROPLETH_METRICS.find(m => m.key === choroplethMetric);
  const data = choroplethCache[choroplethMetric] || {};
  const nationalData = data._national;
  // Exclude _national from state values
  const stateEntries = useMemo(() => Object.entries(data).filter(([k]) => k !== "_national"), [data]);
  const values = stateEntries.map(([, d]) => d.v).filter(v => v != null);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const avgVal = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  // Ranked list (best → worst)
  const ranked = useMemo(() => {
    const arr = stateEntries.map(([st, d]) => ({ st, v: d.v, d: d.d })).filter(x => x.v != null);
    arr.sort((a, b) => metricCfg?.sortAsc ? a.v - b.v : b.v - a.v);
    return arr.map((x, i) => ({ ...x, rank: i + 1 }));
  }, [stateEntries, metricCfg]);
  const rankOf = (st) => { const r = ranked.find(x => x.st === st); return r ? r.rank : null; };

  // Sortable table rows
  const tableRows = useMemo(() => {
    const rows = [...ranked];
    if (tableSortCol === "rank") return tableSortAsc ? rows : [...rows].reverse();
    if (tableSortCol === "state") { rows.sort((a, b) => (STATE_NAMES[a.st] || a.st).localeCompare(STATE_NAMES[b.st] || b.st)); return tableSortAsc ? rows : rows.reverse(); }
    if (tableSortCol === "value") { rows.sort((a, b) => a.v - b.v); return tableSortAsc ? rows : rows.reverse(); }
    return rows;
  }, [ranked, tableSortCol, tableSortAsc]);

  const toggleSort = (col) => {
    if (tableSortCol === col) setTableSortAsc(!tableSortAsc);
    else { setTableSortCol(col); setTableSortAsc(col === "state"); }
  };
  const sortArrow = (col) => tableSortCol === col ? (tableSortAsc ? " \u25B2" : " \u25BC") : "";

  return (<>
    {/* Economy sub-tab bar */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {ECON_SUB_TABS.map(t => (
        <button key={t.id} onClick={() => setEconSubTab(t.id)} style={{
          flex: "1 1 auto", padding: "8px 10px", border: "none", borderRadius: 8,
          background: econSubTab === t.id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: econSubTab === t.id ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
          fontSize: 12, fontWeight: econSubTab === t.id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s",
          borderBottom: econSubTab === t.id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>

    {/* Dashboard landing — the macro cockpit; tiles drill into the subtabs */}
    {econSubTab === "dashboard" && <MacroDashboardSubTab go={setEconSubTab} />}

    {/* Rates sub-tab */}
    {econSubTab === "rates" && <RatesTab md={md} td={td} fmpKey={fmpKey} />}

    {/* Debt & Credit sub-tab */}
    {econSubTab === "debt" && <DebtMarketTab />}
    {econSubTab === "banks" && <BankCreditTab />}
    {econSubTab === "profits" && <ProfitsEngineTab />}

    {/* Fed Balance Sheet sub-tab */}
    {econSubTab === "fed" && <FedSubTab fredKey={fredKey} />}

    {/* GDP sub-tab */}
    {econSubTab === "gdp" && <GdpSubTab gdpData={gdpData} />}

    {/* Housing sub-tab */}
    {econSubTab === "housing" && <HousingSubTab hd={hd} md={md} zillow={zillowData} />}

    {/* CPI sub-tab */}
    {econSubTab === "cpi" && <CpiTab cd={cd} />}

    {/* State-Level sub-tab */}
    {econSubTab === "stateLevel" && (<>
    <SH>State-Level Economic Data</SH>

    {/* Metric tab bar */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {CHOROPLETH_METRICS.map(m => (
        <button key={m.key} onClick={() => setChoroplethMetric(m.key)}
          style={{ padding: "7px 14px", borderRadius: 8, border: choroplethMetric === m.key ? "1px solid #818cf8" : "1px solid rgba(255,255,255,0.08)", background: choroplethMetric === m.key ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.03)", color: choroplethMetric === m.key ? "#c7d2fe" : "#94a3b8", fontSize: 11, fontFamily: fonts.mono, cursor: "pointer", fontWeight: choroplethMetric === m.key ? 600 : 400, transition: "all 0.15s ease" }}>
          {m.label}
        </button>
      ))}
    </div>

    {/* National benchmark card */}
    {metricCfg && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>National {metricCfg.label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>
            {nationalData ? metricCfg.fmt(nationalData.v) : choroplethLoading ? "..." : "—"}
          </div>
          {nationalData?.d && <div style={{ fontSize: 9, color: "#4ade80", fontFamily: fonts.mono, marginTop: 2 }}>{fmtDate(nationalData.d)}</div>}
        </div>
        {values.length > 0 && (
          <React.Fragment>
            <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>State Avg</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.mono }}>{metricCfg.fmt(avgVal)}</div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>Lowest</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: metricCfg.sortAsc ? "#4ade80" : "#f87171", fontFamily: fonts.mono }}>{metricCfg.fmt(minVal)}</div>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", fontFamily: fonts.mono }}>{ranked.length ? STATE_NAMES[ranked[metricCfg.sortAsc ? 0 : ranked.length - 1]?.st] || "" : ""}</div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>Highest</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: metricCfg.sortAsc ? "#f87171" : "#4ade80", fontFamily: fonts.mono }}>{metricCfg.fmt(maxVal)}</div>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", fontFamily: fonts.mono }}>{ranked.length ? STATE_NAMES[ranked[metricCfg.sortAsc ? ranked.length - 1 : 0]?.st] || "" : ""}</div>
            </div>
          </React.Fragment>
        )}
      </div>
    )}

    {/* Map card */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14, position: "relative" }}>
      {choroplethLoading && (
        <div style={{ position: "absolute", top: 12, right: 16, fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, zIndex: 10, background: "rgba(15,23,42,0.9)", padding: "4px 10px", borderRadius: 6 }}>
          {choroplethProgress}
        </div>
      )}
      <ComposableMap projection="geoAlbersUsa" style={{ width: "100%", height: "auto" }} projectionConfig={{ scale: 1000 }}>
        <Geographies geography={US_TOPO_URL}>
          {({ geographies }) => geographies.map(geo => {
            const stCode = FIPS_TO_STATE[geo.id];
            if (!stCode) return null;
            const stData = data[stCode];
            const fill = stData ? choroplethColor(stData.v, minVal, maxVal, metricCfg?.scale || "blue") : "#1e293b";
            return (
              <Geography key={geo.rsmKey} geography={geo}
                onMouseEnter={(e) => {
                  const name = STATE_NAMES[stCode] || stCode;
                  const rank = rankOf(stCode);
                  const val = stData && metricCfg ? metricCfg.fmt(stData.v) : "No data";
                  const rankStr = rank ? ` (#${rank} of ${ranked.length})` : "";
                  setTooltipContent(`${name}: ${val}${rankStr}`);
                  setTooltipPos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => { setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                onMouseLeave={() => { setTooltipContent(""); }}
                style={{
                  default: { fill, stroke: "#0f172a", strokeWidth: 0.5, outline: "none", transition: "fill 0.2s ease" },
                  hover: { fill, stroke: "#e2e8f0", strokeWidth: 1.5, outline: "none", cursor: "pointer", filter: "brightness(1.3)" },
                  pressed: { fill, outline: "none" },
                }}
              />
            );
          })}
        </Geographies>
      </ComposableMap>
      {tooltipContent && (
        <div style={{ position: "fixed", left: tooltipPos.x + 14, top: tooltipPos.y - 12, background: "#0f172aee", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 8, padding: "6px 12px", pointerEvents: "none", zIndex: 1000, fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.heading, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          {tooltipContent}
        </div>
      )}

      {/* Gradient legend */}
      {values.length > 0 && metricCfg && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginTop: 8, padding: "0 20px" }}>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, minWidth: 60, textAlign: "right" }}>{metricCfg.fmt(minVal)}</span>
          <div style={{ flex: 1, maxWidth: 300, height: 10, borderRadius: 5, background: `linear-gradient(to right, ${choroplethColor(minVal, minVal, maxVal, metricCfg.scale)}, ${choroplethColor((minVal+maxVal)/2, minVal, maxVal, metricCfg.scale)}, ${choroplethColor(maxVal, minVal, maxVal, metricCfg.scale)})` }} />
          <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, minWidth: 60 }}>{metricCfg.fmt(maxVal)}</span>
        </div>
      )}
    </div>

    {/* Sortable state table */}
    {tableRows.length > 0 && metricCfg && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(129,140,248,0.08)" }}>
              <th onClick={() => toggleSort("rank")} style={{ padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", cursor: "pointer", userSelect: "none", width: 50 }}>Rank{sortArrow("rank")}</th>
              <th onClick={() => toggleSort("state")} style={{ padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", cursor: "pointer", userSelect: "none" }}>State{sortArrow("state")}</th>
              <th onClick={() => toggleSort("value")} style={{ padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", cursor: "pointer", userSelect: "none" }}>{metricCfg.label}{sortArrow("value")}</th>
              <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", width: 90 }}>vs Natl</th>
              <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", width: 90 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => {
              const diff = nationalData ? row.v - nationalData.v : null;
              const diffColor = diff != null ? (diff === 0 ? "#64748b" : metricCfg.sortAsc ? (diff > 0 ? "#f87171" : "#4ade80") : (diff > 0 ? "#4ade80" : "#f87171")) : "#64748b";
              const fmtDiff = (d) => {
                if (d == null) return "—";
                const sign = d > 0 ? "+" : "";
                if (metricCfg.key === "unemployment" || metricCfg.key === "hpi") return `${sign}${d.toFixed(1)}`;
                if (metricCfg.key === "pcIncome" || metricCfg.key === "medianIncome") return `${sign}$${Math.abs(d).toLocaleString(undefined,{maximumFractionDigits:0})}`;
                if (metricCfg.key === "employment") return `${sign}${d.toLocaleString(undefined,{maximumFractionDigits:0})}K`;
                return metricCfg.fmt(d);
              };
              return (
                <tr key={row.st} style={{ borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b" }}>{row.rank}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: choroplethColor(row.v, minVal, maxVal, metricCfg.scale), marginRight: 8, verticalAlign: "middle" }} />
                    {STATE_NAMES[row.st] || row.st}
                    <span style={{ color: "#64748b", fontSize: 10, marginLeft: 6 }}>{row.st}</span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{metricCfg.fmt(row.v)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: diffColor, textAlign: "right" }}>{fmtDiff(diff)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#64748b" }}>{fmtDate(row.d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    </>)}

    {/* Consumer sub-tab */}
    {econSubTab === "consumer" && <ConsumerTab csm={csm} />}

    {/* Federal Budget sub-tab */}
    {econSubTab === "budget" && <BudgetSubTab fredKey={fredKey} />}

    {/* Labor Market sub-tab */}
    {econSubTab === "labor" && <LaborSubTab fredKey={fredKey} />}
  </>);
}


export default USEconomyTab;
