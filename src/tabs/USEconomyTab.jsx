import React, { useState, useEffect, useMemo } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CHOROPLETH_METRICS } from "../lib/constants.js";
import StateChoropleth from "../components/StateChoropleth.jsx";
import { fetchFMP } from "../lib/api.js";
import { fmtDate, SH, InfoBox } from "../components/shared.jsx";
import RatesTab from "./RatesTab.jsx";
import CpiTab from "./CpiTab.jsx";
import ConsumerTab from "./ConsumerTab.jsx";
import GdpSubTab from "./GdpSubTab.jsx";
import BudgetSubTab from "./BudgetSubTab.jsx";
import LaborSubTab from "./LaborSubTab.jsx";
import FedSubTab from "./FedSubTab.jsx";
import UsPulseTab from "./UsPulseTab.jsx";
import DebtMarketTab from "./DebtMarketTab.jsx";
import BankCreditTab from "./BankCreditTab.jsx";
import ProfitsEngineTab from "./ProfitsEngineTab.jsx";

function USEconomyTab({ md, td, gd, cd, csm, hd, zillowData, fredKey, fmpKey, choroplethCache, choroplethMetric, setChoroplethMetric, fetchChoroplethData, choroplethLoading, choroplethProgress }) {
  const [econSubTab, setEconSubTab] = useState("dashboard");
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
    { id: "dashboard",  label: "Pulse"               },
    { id: "rates",      label: "Rates"               },
    { id: "debt",       label: "Debt & Credit"       },
    { id: "banks",      label: "Bank Credit"         },
    { id: "profits",    label: "Profits Engine"      },
    { id: "fed",        label: "Fed Balance Sheet"   },
    { id: "gdp",        label: "GDP"                 },
    { id: "cpi",        label: "CPI"                 },
    { id: "stateLevel", label: "State-Level"         },
    { id: "consumer",   label: "Consumer"            },
    { id: "budget",     label: "Fed. Budget"         },
    { id: "labor",      label: "Labor"               },
  ];

  // The State-Level map keeps the economy metrics; real-estate metrics live on the Real Estate tab.
  const ECON_MAP_METRICS = CHOROPLETH_METRICS.filter(m => m.group !== "realestate" && m.source !== "zillow");

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

    {/* Pulse landing — leading indicators, consumer health, debt picture; rows drill into the subtabs */}
    {econSubTab === "dashboard" && <UsPulseTab go={setEconSubTab} />}

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

    {/* CPI sub-tab */}
    {econSubTab === "cpi" && <CpiTab cd={cd} />}

    {/* State-Level sub-tab */}
    {econSubTab === "stateLevel" && (
      <StateChoropleth title="State-Level Economic Data" metrics={ECON_MAP_METRICS} metric={choroplethMetric} setMetric={setChoroplethMetric} cache={choroplethCache} loading={choroplethLoading} progress={choroplethProgress} />
    )}

    {/* Consumer sub-tab */}
    {econSubTab === "consumer" && <ConsumerTab csm={csm} />}

    {/* Federal Budget sub-tab */}
    {econSubTab === "budget" && <BudgetSubTab fredKey={fredKey} />}

    {/* Labor Market sub-tab */}
    {econSubTab === "labor" && <LaborSubTab fredKey={fredKey} />}
  </>);
}


export default USEconomyTab;
