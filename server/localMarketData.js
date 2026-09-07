import XLSX from 'xlsx';
import { METROS } from './realEstateFeeds.js';
import { fetchConcessions } from './rentalConcessions.js';

const positiveNumber = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const acsUrl = (year,table) => `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/1YRData/acsdt1y${year}-${table.toLowerCase()}.dat`;
const zillowRoot = 'https://files.zillowstatic.com/research/public_csvs/';
export const LOCAL_SOURCES = {
  households:acsUrl(2024,'B11001'), householdsPrevious:acsUrl(2023,'B11001'),
  income:acsUrl(2024,'B25119'), tenure:acsUrl(2024,'B25003'),
  rentHistory:zillowRoot+'zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv',
  singleRentHistory:zillowRoot+'zori/Metro_zori_uc_sfr_sm_sa_month.csv',
  multiRentHistory:zillowRoot+'zori/Metro_zori_uc_mfr_sm_sa_month.csv',
  priceHistory:zillowRoot+'zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
  permitReleases:'https://www.census.gov/construction/bps/msamonthly.html',
};

export function parseAcsTable(text, table, columns) {
  const lines=text.trim().split(/\r?\n/), headers=lines.shift().replace(/^\uFEFF/,'').split('|');
  const fields=columns.map(c=>({name:c,estimate:headers.indexOf(`${table}_E${c}`),moe:headers.indexOf(`${table}_M${c}`)}));
  if(fields.some(f=>f.estimate<0||f.moe<0))throw new Error(`${table} columns unavailable`);
  return Object.fromEntries(lines.map(l=>l.split('|')).filter(c=>/^310M700US\d{5}$/.test(c[0])).map(c=>[c[0].slice(-5),Object.fromEntries(fields.map(f=>[f.name,{value:positiveNumber(c[f.estimate]),moe:positiveNumber(c[f.moe])}]))]));
}

export function householdChange(current, previous) {
  if(current?.value==null || previous?.value==null || previous.value<=0) return {change:null,growth:null,moe:null,clear:null};
  const change=current.value-previous.value;
  // Approximate 90% margin for a difference of independent annual estimates.
  const moe=current.moe!=null&&previous.moe!=null?Math.hypot(current.moe,previous.moe):null;
  return {change,growth:100*change/previous.value,moe,clear:moe==null?null:Math.abs(change)>moe};
}

function splitCsv(line) {
  const cells=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){cells.push(value);value='';}else value+=c;
  }
  cells.push(value);return cells;
}
export function parseZillowHistory(text, names) {
  const lines=text.trim().split(/\r?\n/),head=splitCsv(lines.shift().replace(/^\uFEFF/,''));
  const ni=head.indexOf('RegionName'), ti=head.indexOf('RegionType');
  const dates=head.map((date,i)=>/^\d{4}-\d{2}-\d{2}$/.test(date)?{date,i}:null).filter(Boolean);
  if(ni<0||ti<0||!dates.length)throw new Error('Zillow history columns unavailable');
  const rows={};
  for(const line of lines){const c=splitCsv(line);if(c[ti]!=='country'&&!names.has(c[ni]))continue;
    rows[c[ti]==='country'?'US':c[ni]]=dates.map(({date,i})=>({date,value:positiveNumber(c[i])})).filter(p=>p.value>0);
  }
  return rows;
}
const monthBefore=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1-n,1)).toISOString().slice(0,7);};
export function combinePriceRentHistory(rents=[],prices=[]) {
  const rentMap=Object.fromEntries(rents.map(p=>[p.date.slice(0,7),p.value])), priceMap=Object.fromEntries(prices.map(p=>[p.date.slice(0,7),p.value]));
  const growth=(map,m,lag=12)=>map[m]!=null&&map[monthBefore(m,lag)]>0?100*(Math.pow(map[m]/map[monthBefore(m,lag)],12/lag)-1):null;
  return [...new Set([...Object.keys(rentMap),...Object.keys(priceMap)])].sort().slice(-84).map(month=>({date:month,rent:rentMap[month]??null,price:priceMap[month]??null,rentYoy:growth(rentMap,month),priceYoy:growth(priceMap,month),rentMomentum:growth(rentMap,month,3)}));
}

export function parseMonthlyPermits(buffer) {
  const book=XLSX.read(buffer), sheet=book.SheetNames.find(n=>/Units/.test(n));
  if(!sheet)throw new Error('Monthly permit units unavailable');
  const rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1});
  const index=rows.findIndex(r=>r[1]==='CBSA'&&r[11]==='Total'&&r[15]==='5 Units or More');
  if(index<0)throw new Error('Monthly permit columns changed');
  return Object.fromEntries(rows.slice(index+1).filter(r=>/^\d{5}$/.test(String(r[1]))&&[2,4].includes(r[3])).map(r=>[String(r[1]),{
    total:positiveNumber(r[11]),single:positiveNumber(r[12]),
    small:positiveNumber(r[13])!=null&&positiveNumber(r[14])!=null?Number(r[13])+Number(r[14]):null,
    multi:positiveNumber(r[15]),
  }]));
}
export function latestPermitPeriod(html, currentMonth=new Date().toISOString().slice(0,7).replace('-','')) {
  return [...new Set([...html.matchAll(/cbsamonthly_(\d{6})\.xls/g)].map(m=>m[1]))].filter(m=>m<=currentMonth&&Number(m.slice(4))>=1&&Number(m.slice(4))<=12).sort().at(-1)||null;
}

export async function fetchLocalMarketData() {
  const get=async(url,type='text')=>{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`Source returned HTTP ${r.status}`);return type==='buffer'?Buffer.from(await r.arrayBuffer()):r.text();};
  const names=new Set(METROS.map(m=>m.z));
  const acs=async(key,table,cols)=>parseAcsTable(await get(LOCAL_SOURCES[key]),table,cols);
  const jobs={
    households:()=>acs('households','B11001',['001']),
    householdsPrevious:()=>acs('householdsPrevious','B11001',['001']),
    income:()=>acs('income','B25119',['001','003']),
    tenure:()=>acs('tenure','B25003',['001','003']),
    rentHistory:async()=>parseZillowHistory(await get(LOCAL_SOURCES.rentHistory),names),
    singleRentHistory:async()=>parseZillowHistory(await get(LOCAL_SOURCES.singleRentHistory),names),
    multiRentHistory:async()=>parseZillowHistory(await get(LOCAL_SOURCES.multiRentHistory),names),
    concessions:()=>fetchConcessions(get),
    priceHistory:async()=>parseZillowHistory(await get(LOCAL_SOURCES.priceHistory),names),
    recentPermits:async()=>{
      const period=latestPermitPeriod(await get(LOCAL_SOURCES.permitReleases));
      if(!period)throw new Error('Latest permit release not found');
      const prior=`${Number(period.slice(0,4))-1}${period.slice(4)}`;
      const currentUrl=`https://www.census.gov/construction/bps/xls/cbsamonthly_${period}.xls`,previousUrl=`https://www.census.gov/construction/bps/xls/cbsamonthly_${prior}.xls`;
      const [current,previous]=await Promise.all([get(currentUrl,'buffer').then(parseMonthlyPermits),get(previousUrl,'buffer').then(parseMonthlyPermits)]);
      return {period:`${period.slice(0,4)}-${period.slice(4)}`,current,previous,currentUrl,previousUrl};
    },
  };
  const keys=Object.keys(jobs),results=await Promise.allSettled(keys.map(k=>jobs[k]()));
  const values={},status={};results.forEach((r,i)=>{status[keys[i]]=r.status==='fulfilled'?'available':'unavailable';if(r.status==='fulfilled')values[keys[i]]=r.value;});
  const profiles={};
  for(const m of METROS){
    const hh=values.households?.[m.code]?.['001'], oldHh=values.householdsPrevious?.[m.code]?.['001'];
    const income=values.income?.[m.code],tenure=values.tenure?.[m.code];
    const permits=values.recentPermits?.current[m.code],oldPermits=values.recentPermits?.previous[m.code];
    const history=combinePriceRentHistory(values.rentHistory?.[m.z],values.priceHistory?.[m.z]);
    const rentNow=history.filter(p=>p.rent!=null).at(-1),priceNow=history.filter(p=>p.price!=null).at(-1);
    const rentTypes=Object.fromEntries([['single','singleRentHistory'],['multi','multiRentHistory']].map(([type,key])=>{
      const points=combinePriceRentHistory(values[key]?.[m.z]);
      return [type,{history:points,latest:points.at(-1)??null}];
    }));
    profiles[m.code]={
      households:hh?.value??null,householdsMoe:hh?.moe??null,householdTrend:householdChange(hh,oldHh),
      renterIncome:income?.['003']?.value??null,renterIncomeMoe:income?.['003']?.moe??null,medianIncome:income?.['001']?.value??null,
      renterShare:tenure?.['001']?.value>0&&tenure?.['003']?.value!=null?100*tenure['003'].value/tenure['001'].value:null,
      permitsYtd:permits??null,permitsPreviousYtd:oldPermits??null,
      permitsYtdChange:permits?.total!=null&&oldPermits?.total>0?100*(permits.total/oldPermits.total-1):null,
      history,rentNow:rentNow??null,priceNow:priceNow??null,
      rentTypes,concessionShare:values.concessions?.shares[m.z]??null,
      askingRentIncome:rentNow?.rent!=null&&income?.['003']?.value>0?1200*rentNow.rent/income['003'].value:null,
    };
  }
  return {profiles,acsYear:2024,acsPreviousYear:2023,nationalHistory:combinePriceRentHistory(values.rentHistory?.US,values.priceHistory?.US),
    concessions:values.concessions??null,
    permitPeriod:values.recentPermits?.period??null,sources:{...LOCAL_SOURCES,permitsYtd:values.recentPermits?.currentUrl??null,permitsPreviousYtd:values.recentPermits?.previousUrl??null},status,
  };
}
