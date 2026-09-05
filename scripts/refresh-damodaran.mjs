// Refresh Damodaran datasets → src/lib/damodaran.json
// Run once a year (he updates in the first two weeks of January):
//   node scripts/refresh-damodaran.mjs
// Parses:
//   histimpl.xls — implied equity risk premium (FCFE), annual, 1960→
//   ratings.xls  — interest-coverage → synthetic rating → default spread
// Build-time by design: his server is fragile and the data changes once a
// year, so the app ships a checked-in snapshot with zero runtime dependency.
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "lib", "damodaran.json");
const BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

async function download(name) {
  const resp = await fetch(`${BASE}/${name}`, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// ── histimpl.xls → annual implied ERP series ──
function parseErp(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Historical Impl Premiums"], { header: 1 });
  // header row: Year | Earnings Yield | ... | T.Bond Rate(10) | ... |
  // Implied Premium (DDM)(13) | ... | Implied ERP (FCFE)(15)
  const out = [];
  for (const r of rows) {
    const y = r?.[0];
    if (typeof y !== "number" || y < 1900 || y > 2100) continue;
    out.push({
      y,
      erp: num(r[15]),      // Implied ERP (FCFE) — Damodaran's headline number
      ddm: num(r[13]),      // DDM variant
      ey: num(r[1]),        // earnings yield
      tbond: num(r[10]),    // 10Y T-bond rate at year end
      sp: num(r[3]),        // S&P 500 level
    });
  }
  if (out.length < 50) throw new Error(`histimpl parse suspiciously short: ${out.length} rows`);
  return out;
}

// ── ratings.xls → coverage→rating→spread bands ──
function parseRatings(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Start here Ratings sheet"], { header: 1 });
  const band = (r) => ({ min: num(r[0]), max: num(r[1]), rating: String(r[2]), spread: num(r[3]) });
  const isBand = (r) => typeof r?.[0] === "number" && typeof r?.[1] === "number" && typeof r?.[2] === "string" && typeof r?.[3] === "number";
  // Two tables: large non-financial firms, then smaller/riskier firms.
  const large = [], small = [];
  let section = 0; // 1 = in large table, 2 = in small table
  for (const r of rows) {
    const text = String(r?.[0] ?? "");
    if (text.startsWith("For large non-financial")) section = 1;
    else if (text.startsWith("For smaller and riskier")) section = 2;
    else if (isBand(r) && section) {
      (section === 2 ? small : large).push(band(r));
      if (r[1] >= 99999) section = 0; // Aaa row closes the table
    }
  }
  if (large.length < 10 || small.length < 10) throw new Error(`ratings parse short: large=${large.length} small=${small.length}`);
  return { large, small };
}

const [histimpl, ratings] = await Promise.all([download("histimpl.xls"), download("ratings.xls")]);
const erp = parseErp(histimpl);
const bands = parseRatings(ratings);
const data = {
  asOf: new Date().toISOString().slice(0, 10),
  source: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
  note: "Annual snapshot of Damodaran datasets. Re-run scripts/refresh-damodaran.mjs each January.",
  erp,
  ratings: bands,
};
fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
const last = erp[erp.length - 1];
console.log(`Wrote ${OUT}`);
console.log(`  ERP: ${erp.length} years (${erp[0].y}–${last.y}); latest implied ERP (FCFE) ${(last.erp * 100).toFixed(2)}% vs T-bond ${(last.tbond * 100).toFixed(2)}%`);
console.log(`  Ratings: ${bands.large.length} large-firm bands, ${bands.small.length} small-firm bands`);
