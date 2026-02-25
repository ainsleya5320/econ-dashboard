import React, { useState, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, AreaChart, Area, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

function HousingSubTab({ hd, md, zillow }) {
  const [metroSort, setMetroSort] = useState("zhvi");
  const [metroSortAsc, setMetroSortAsc] = useState(false);
  const [metroView, setMetroView] = useState("table"); // table | chart

  const z = zillow || {};
  const zn = z.national || {};
  const metros = z.metros || [];

  // National ZHVI trend
  const zhviHistory = useMemo(() => {
    if (!zn.zhvi?.history?.length) return [];
    return zn.zhvi.history.map(h => ({ d: h.d, ZHVI: h.v }));
  }, [zn.zhvi]);

  // National ZORI trend
  const zoriHistory = useMemo(() => {
    if (!zn.zori?.history?.length) return [];
    return zn.zori.history.map(h => ({ d: h.d, ZORI: h.v }));
  }, [zn.zori]);

  // National inventory trend
  const inventoryHistory = useMemo(() => {
    if (!zn.inventory?.history?.length) return [];
    return zn.inventory.history.map(h => ({ d: h.d, Inventory: h.v }));
  }, [zn.inventory]);

  // National new listings trend
  const newListHistory = useMemo(() => {
    if (!zn.newListings?.history?.length) return [];
    return zn.newListings.history.map(h => ({ d: h.d, NewListings: h.v }));
  }, [zn.newListings]);

  // Combined inventory + new listings
  const supplyHistory = useMemo(() => {
    if (!zn.inventory?.history?.length) return [];
    const inv = zn.inventory.history;
    const nl = zn.newListings?.history || [];
    return inv.map(h => {
      const nlPoint = nl.find(n => n.d === h.d);
      const row = { d: h.d, Inventory: h.v };
      if (nlPoint) row.NewListings = nlPoint.v;
      return row;
    });
  }, [zn.inventory, zn.newListings]);

  // Construction from FRED
  const constructionData = useMemo(() => {
    const starts = hd?.HOUST?.history || [];
    return starts.map(h => {
      const r = { d: h.d, HOUST: h.v };
      const p = hd?.PERMIT?.history?.find(x => x.d === h.d);
      if (p) r.PERMIT = p.v;
      return r;
    });
  }, [hd]);

  // Sorted metros
  const sortedMetros = useMemo(() => {
    const arr = [...metros].filter(m => m.zhvi);
    arr.sort((a, b) => {
      let va = a[metroSort], vb = b[metroSort];
      if (va == null) va = metroSortAsc ? Infinity : -Infinity;
      if (vb == null) vb = metroSortAsc ? Infinity : -Infinity;
      return metroSortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [metros, metroSort, metroSortAsc]);

  const toggleMetroSort = (col) => {
    if (metroSort === col) setMetroSortAsc(!metroSortAsc);
    else { setMetroSort(col); setMetroSortAsc(col === "name"); }
  };

  const fmtDollar = (v) => {
    if (v == null) return "—";
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${(v / 1000).toFixed(0)}K`;
  };
  const fmtRent = (v) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
  const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtInv = (v) => {
    if (v == null) return "—";
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toLocaleString();
  };

  const sortArrow = (col) => metroSort === col ? (metroSortAsc ? " ▲" : " ▼") : "";

  const isLoading = !zillow;

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🏠</div>
        <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: fonts.mono }}>Loading Zillow housing data...</div>
        <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 6 }}>Fetching home values, rents, and inventory</div>
      </div>
    );
  }

  return (<>
    {/* National Overview Cards */}
    <SH>National Housing Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Typical Home Value" value={zn.zhvi?.current} color="#3B82F6" format="dollar" subtitle={zn.zhvi?.yoy != null ? `${zn.zhvi.yoy >= 0 ? "+" : ""}${zn.zhvi.yoy.toFixed(1)}% YoY` : "Zillow ZHVI"} date={zn.zhvi?.lastDate} />
      <RateCard label="Typical Monthly Rent" value={zn.zori?.current} color="#8B5CF6" format="plain" subtitle={zn.zori?.yoy != null ? `${zn.zori.yoy >= 0 ? "+" : ""}${zn.zori.yoy.toFixed(1)}% YoY` : "Zillow ZORI"} date={zn.zori?.lastDate} />
      <RateCard label="30-Year Mortgage" value={md?.MORTGAGE30US?.current} color="#F59E0B" subtitle="Fixed rate avg" date={md?.MORTGAGE30US?.lastDate} />
      <RateCard label="For-Sale Inventory" value={zn.inventory?.current} color="#10B981" format="plain" subtitle={zn.inventory?.yoy != null ? `${zn.inventory.yoy >= 0 ? "+" : ""}${zn.inventory.yoy.toFixed(1)}% YoY` : "Total listings"} date={zn.inventory?.lastDate} />
      <RateCard label="Housing Starts" value={hd?.HOUST?.current} color="#E8553A" format="thousands" subtitle="Thousands, SAAR" date={hd?.HOUST?.lastDate} small />
      <RateCard label="Months' Supply" value={hd?.MSACSR?.current} color="#D946EF" format="months" subtitle={hd?.MSACSR?.current < 4 ? "Tight market" : hd?.MSACSR?.current > 6 ? "Buyer's market" : "Balanced"} date={hd?.MSACSR?.lastDate} small />
    </div>

    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Zillow Home Value Index (ZHVI)</strong> is a smoothed, seasonally adjusted measure of the typical home value across a given region. <strong style={{ color: "#cbd5e1" }}>ZORI</strong> tracks typical monthly rents. Both are considered more timely than Census or FHFA data.
    </InfoBox>

    {/* Home Value Trend */}
    {zhviHistory.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
          National Home Value (Zillow ZHVI)
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={zhviHistory} margin={{ top: 5, right: 8, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-zhvi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtAxisDate} interval={Math.max(0, Math.floor(zhviHistory.length / 8) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate} formatter={v => [`$${Math.round(v).toLocaleString()}`, "Home Value"]} />
            <Area type="monotone" dataKey="ZHVI" stroke="#3B82F6" fill="url(#g-zhvi)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Rent Trend */}
    {zoriHistory.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
          National Typical Rent (Zillow ZORI)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={zoriHistory} margin={{ top: 5, right: 8, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-zori" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtAxisDate} interval={Math.max(0, Math.floor(zoriHistory.length / 8) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v).toLocaleString()}`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate} formatter={v => [`$${Math.round(v).toLocaleString()}/mo`, "Typical Rent"]} />
            <Area type="monotone" dataKey="ZORI" stroke="#8B5CF6" fill="url(#g-zori)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Supply & Inventory */}
    <SH>Supply & Inventory</SH>
    {supplyHistory.length > 0 && (
      <ChartCard data={supplyHistory} series={{ Inventory: { label: "For-Sale Inventory", color: "#10B981" }, NewListings: { label: "New Listings", color: "#F59E0B" } }} title="National Inventory & New Listings" yFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`} />
    )}

    <div style={{ height: 14 }} />
    <ChartCard data={(hd?.MSACSR?.history || []).map(h => ({ d: h.d, MSACSR: h.v }))} series={{ MSACSR: { label: "Months' Supply", color: "#D946EF" } }} title="Months' Supply of Homes (FRED)" yFormatter={v => `${v}`} refLine={6} />

    {/* Construction Activity */}
    <SH>Construction Activity</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Housing Starts" value={hd?.HOUST?.current} color="#10B981" format="thousands" subtitle="Thousands, SAAR" date={hd?.HOUST?.lastDate} small />
      <RateCard label="Building Permits" value={hd?.PERMIT?.current} color="#8B5CF6" format="thousands" subtitle="Thousands, SAAR" date={hd?.PERMIT?.lastDate} small />
      <RateCard label="Existing Sales" value={hd?.EXHOSLUSM495S?.current} color="#F59E0B" format="thousands" subtitle="Thousands, SAAR" date={hd?.EXHOSLUSM495S?.lastDate} small />
    </div>
    {constructionData.length > 0 && (
      <ChartCard data={constructionData} series={{ HOUST: { label: "Housing Starts", color: "#10B981" }, PERMIT: { label: "Building Permits", color: "#8B5CF6" } }} title="New Construction (Thousands, SAAR)" yFormatter={v => `${v}`} />
    )}

    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>Months' supply</strong> under 4 = seller's market; over 6 = buyer's market. <strong style={{ color: "#cbd5e1" }}>Starts</strong> and <strong style={{ color: "#cbd5e1" }}>permits</strong> are leading indicators of future supply.
    </InfoBox>

    {/* Top Metros Table */}
    {sortedMetros.length > 0 && (<>
      <SH>Top Metros Comparison</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "rgba(59,130,246,0.08)" }}>
                <th style={{ ...thStyle, width: 40, cursor: "default" }}>#</th>
                <th onClick={() => toggleMetroSort("name")} style={{ ...thStyle, textAlign: "left", cursor: "pointer" }}>Metro{sortArrow("name")}</th>
                <th onClick={() => toggleMetroSort("zhvi")} style={{ ...thStyle, cursor: "pointer" }}>Home Value{sortArrow("zhvi")}</th>
                <th onClick={() => toggleMetroSort("zhviYoy")} style={{ ...thStyle, cursor: "pointer" }}>1Y Change{sortArrow("zhviYoy")}</th>
                <th onClick={() => toggleMetroSort("zori")} style={{ ...thStyle, cursor: "pointer" }}>Monthly Rent{sortArrow("zori")}</th>
                <th onClick={() => toggleMetroSort("listPrice")} style={{ ...thStyle, cursor: "pointer" }}>List Price{sortArrow("listPrice")}</th>
                <th onClick={() => toggleMetroSort("inventory")} style={{ ...thStyle, cursor: "pointer" }}>Inventory{sortArrow("inventory")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedMetros.map((m, i) => (
                <tr key={m.name} style={{ borderBottom: i < sortedMetros.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ ...tdStyle, color: "#64748b", fontSize: 10 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 500, color: "#e2e8f0" }}>
                    <div style={{ fontSize: 12, fontFamily: fonts.heading }}>{m.name.split(",")[0]}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{m.state || m.name.split(",").slice(1).join(",").trim()}</div>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: "#f1f5f9" }}>{fmtDollar(m.zhvi)}</td>
                  <td style={{ ...tdStyle, color: m.zhviYoy > 0 ? "#4ade80" : m.zhviYoy < 0 ? "#f87171" : "#94a3b8", fontWeight: 600 }}>{fmtPct(m.zhviYoy)}</td>
                  <td style={{ ...tdStyle, color: "#c4b5fd" }}>{fmtRent(m.zori)}</td>
                  <td style={{ ...tdStyle, color: "#cbd5e1" }}>{fmtDollar(m.listPrice)}</td>
                  <td style={{ ...tdStyle, color: "#94a3b8" }}>{fmtInv(m.inventory)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>)}
  </>);
}

const thStyle = {
  padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono,
  textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", userSelect: "none",
};
const tdStyle = {
  padding: "8px 12px", fontSize: 12, fontFamily: fonts.mono, textAlign: "right",
};

export default HousingSubTab;
