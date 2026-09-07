import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { METROS } from './realEstateFeeds.js';
import { fetchLocalMarketData } from './localMarketData.js';

const DAY = 86400000;
const numeric = v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function parseHousingStock(text) {
  const lines = text.trim().split(/\r?\n/), header = lines.shift().split('|');
  const ei = header.indexOf('B25001_E001'), mi = header.indexOf('B25001_M001');
  if (ei < 0 || mi < 0) throw new Error('Housing stock file format changed');
  return Object.fromEntries(lines.map(l => l.split('|')).filter(c => /^310M700US\d{5}$/.test(c[0])).map(c => [c[0].slice(-5), {units:numeric(c[ei]),moe:numeric(c[mi])}]));
}
export function parsePermits(buffer) {
  const wb = XLSX.read(buffer), sheet = wb.SheetNames.find(n => /Units/.test(n));
  if (!sheet) throw new Error('Permits unit table unavailable');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1});
  const hi = rows.findIndex(r => r[1] === 'CBSA' && r[4] === 'Total' && r[8] === '5 Units or More');
  if (hi < 0) throw new Error('Permits file format changed');
  return Object.fromEntries(rows.slice(hi+1).filter(r => /^\d{5}$/.test(String(r[1])) && [2,4].includes(r[3])).map(r => [String(r[1]),{name:String(r[2]).trim(), total:numeric(r[4]), multi:numeric(r[8])}]));
}
export function joinMetroData(permits, previous, stock, rents) {
  return METROS.map(m => {
    const p = permits[m.code], before = previous[m.code], s = stock[m.code], z = rents.metros.find(z => z.name === m.z);
    return {...m, censusName:p?.name ?? null, permits:p?.total ?? null, multiPermits:p?.multi ?? null,
      permitsChange:p?.total != null && before?.total > 0 ? (p.total / before.total - 1)*100 : null,
      units:s?.units ?? null, stockMoe:s?.moe ?? null,
      permitsPer1000:p?.total != null && s?.units > 0 ? 1000*p.total/s.units : null,
      multiShare:p?.total > 0 && p.multi != null ? 100*p.multi/p.total : null,
      rent:z?.zori ?? null, rentGrowth:z?.zoriYoy ?? null, homeValue:z?.zhvi ?? null, priceGrowth:z?.zhviYoy ?? null,
      // Earlier caches only recorded the value date; never invent a rent observation date.
      rentDate:z?.rentDate ?? rents.asOf ?? null, valueDate:z?.d ?? null,
    };
  });
}

export function createMetroComparison({dir, getRents}) {
  const cacheDir = path.join(dir,'.investment-lab');
  const read = name => { try {return JSON.parse(fs.readFileSync(path.join(cacheDir,name),'utf8'));} catch {return null;} };
  const write = (name,data) => {
    fs.mkdirSync(cacheDir,{recursive:true});
    const target = path.join(cacheDir,name), temp = target+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(data)); fs.renameSync(temp,target);
  };
  async function request(url) {
    const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
    if(!r.ok) throw new Error(`Data provider returned HTTP ${r.status}`);
    return r;
  }
  let metroPending;
  async function metro() {
    const old = read('metro.json');
    if(old?.version===4 && Date.now()-Date.parse(old.fetchedAt)<(old.partial ? DAY/24 : DAY)) return old;
    if(metroPending) return metroPending;
    metroPending=(async()=>{
      try {
        const sources={permits:'https://www.census.gov/construction/bps/xls/cbsaannual_202599.xls',previous:'https://www.census.gov/construction/bps/xls/cbsaannual_202499.xls',stock:'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/1YRData/acsdt1y2024-b25001.dat',rents:'https://www.zillow.com/research/data/'};
        const [p,b,s,rents,local]=await Promise.all([
          request(sources.permits).then(r=>r.arrayBuffer()).then(b=>parsePermits(Buffer.from(b))),
          request(sources.previous).then(r=>r.arrayBuffer()).then(b=>parsePermits(Buffer.from(b))),
          request(sources.stock).then(r=>r.text()).then(parseHousingStock), getRents(), fetchLocalMarketData(),
        ]);
        const rows=joinMetroData(p,b,s,rents).map(row=>{
          const profile=local.profiles[row.code]||{};
          return {...row,...profile,
            rent:profile.rentNow?.rent??row.rent,rentGrowth:profile.rentNow?profile.rentNow.rentYoy:row.rentGrowth,rentDate:profile.rentNow?.date??row.rentDate,
            homeValue:profile.priceNow?.price??row.homeValue,priceGrowth:profile.priceNow?profile.priceNow.priceYoy:row.priceGrowth,valueDate:profile.priceNow?.date??row.valueDate,
          };
        });
        if(rows.filter(r=>r.permitsPer1000!=null&&r.rentGrowth!=null).length<20) throw new Error('Metro coverage is incomplete');
        const data={version:4,rows,permitYear:2025,stockYear:2024,rentDate:rents.asOf,sources:{...sources,...local.sources},concessions:local.concessions,
          nationalHistory:local.nationalHistory,acsYear:local.acsYear,acsPreviousYear:local.acsPreviousYear,permitPeriod:local.permitPeriod,sourceStatus:local.status,
          partial:Object.values(local.status).some(s=>s==='unavailable'),fetchedAt:new Date().toISOString(),stale:false};
        write('metro.json',data);return data;
      }catch(e){if(old) return {...old,stale:true,warning:'Refresh failed; showing the last successful comparison.'};throw e;}
      finally{metroPending=null;}
    })();return metroPending;
  }
  function register(server) {
    server.middlewares.use('/api/re-metro-comparison',async(req,res,next)=>{
      const url=new URL(req.url||'/','http://localhost');
      if(url.pathname!=='/') return next();
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET') {res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      try {res.end(JSON.stringify(await metro()));}
      catch(e) {res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }
  return {metro,register};
}
