const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const clean = html => html.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

export function discoverRentReport(html, now = new Date()) {
  const candidates = [...html.matchAll(/href=["'](https:\/\/www\.zillow\.com\/research\/([a-z]+)-(\d{4})-rent-report-\d+\/)["']/gi)]
    .map(m => ({url:m[1], period:`${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase())+1).padStart(2,'0')}`}))
    .filter(r => !r.period.endsWith('-00') && r.period <= now.toISOString().slice(0,7))
    .sort((a,b) => b.period.localeCompare(a.period));
  if(!candidates.length) throw new Error('Monthly rental report not found');
  return candidates[0];
}

export function parseConcessionReport(html, {url,period}) {
  const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m=>m[0]).find(t=>/Concession Share/i.test(clean(t)));
  if(!table) throw new Error('Rental report has no concession table');
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>clean(c[1])));
  const header = rows.findIndex(r=>r.some(c=>/^Concession Share$/i.test(c)));
  const mi = rows[header]?.findIndex(c=>/^Metro$/i.test(c)), ci = rows[header]?.findIndex(c=>/^Concession Share$/i.test(c));
  if(mi == null || mi < 0 || ci < 0) throw new Error('Concession columns changed');
  const shares = {};
  for(const cells of rows.slice(header+1)) {
    const value = cells[ci]?.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if(value && Number(value[1]) <= 100 && cells[mi]) shares[cells[mi]==='United States'?'US':cells[mi]] = Number(value[1]);
  }
  if(shares.US == null) throw new Error('National concession comparison unavailable');
  const publishedAt = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return {period,publishedAt,url,shares};
}

export async function fetchConcessions(get) {
  const report = discoverRentReport(await get('https://www.zillow.com/research/data/'));
  return parseConcessionReport(await get(report.url),report);
}
