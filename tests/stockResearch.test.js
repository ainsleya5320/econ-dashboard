import test from 'node:test';
import assert from 'node:assert/strict';
import {annualRecords,quarterRecords,trailingRecord,periodMetrics,growthRate,currentValuation,sheetWarnings,uniquePeriods,numeric} from '../src/lib/stockResearch.js';
import {fetchStockDetail} from '../src/lib/stockDetail.js';

const fy=(year,extra={})=>({date:year+'-12-31',fiscalYear:String(year),period:'FY',reportedCurrency:'USD',revenue:100,netIncome:20,epsDiluted:2,weightedAverageShsOutDil:10,...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function quarters() {
  const qinc=[['2025-09-30',2025,'Q3'],['2025-12-31',2025,'Q4'],['2026-03-31',2026,'Q1'],['2026-06-30',2026,'Q2']].map(([date,fiscalYear,period],index)=>({date,fiscalYear:String(fiscalYear),period,reportedCurrency:'USD',revenue:100+index*10,netIncome:20,epsDiluted:2,weightedAverageShsOutDil:10}));
  return {inc:[fy(2025)],qinc,qcf:qinc.map(q=>({...q,operatingCashFlow:18,capitalExpenditure:-3,freeCashFlow:15,commonDividendsPaid:-2,commonStockRepurchased:-4,stockBasedCompensation:1})),qbs:qinc.map((q,i)=>({...q,totalStockholdersEquity:100+i*10,totalDebt:20+i,cashAndCashEquivalents:30,shortTermInvestments:40,cashAndShortTermInvestments:70}))};
}

test('annual joins use exact fiscal date, period and currency rather than array position',()=>{
 const data={inc:[fy(2025),fy(2024)],bs:[fy(2024,{totalDebt:30}),fy(2025,{reportedCurrency:'EUR',totalDebt:99})],cf:[fy(2025,{freeCashFlow:20})]};
 const rows=annualRecords(data);
 assert.deepEqual(rows.map(p=>p.year),['2024','2025']);
 assert.equal(rows[0].b.totalDebt,30);assert.deepEqual(rows[1].b,{});
 assert.equal(periodMetrics(rows[0]).fcf,null);assert.equal(periodMetrics(rows[1]).fcf,20);
 assert.ok(sheetWarnings(data,rows,null).some(w=>w.includes('do not align')));
});

test('deduplication keeps the latest available filing revision and tolerates missing inputs',()=>{
 const rows=uniquePeriods([fy(2025,{acceptedDate:'2026-02-01',revenue:100}),fy(2025,{acceptedDate:'2026-03-01',revenue:105})]);
 assert.equal(rows.length,1);assert.equal(rows[0].revenue,105);
 assert.deepEqual(uniquePeriods(null),[]);assert.equal(numeric(''),null);assert.equal(numeric('0'),0);
});

test('trailing flows sum four quarters while the balance sheet remains a point-in-time snapshot',()=>{
 const data=quarters(),t=trailingRecord(data),m=periodMetrics(t);
 assert.equal(t.date,'2026-06-30');assert.equal(m.revenue,460);assert.equal(m.netIncome,80);assert.equal(m.eps,8);
 assert.equal(m.fcf,60);assert.equal(m.fcfPerShare,6);assert.equal(m.shares,10);
 assert.equal(m.equity,130);assert.equal(m.debt,23);assert.equal(m.netDebt,-7);assert.equal(m.liquidAssets,70);
 assert.equal(m.roic,null);assert.equal(m.roe,null);
});

test('trailing history requires contiguous fiscal quarters, aligned dates and comparable currency',()=>{
 const a=quarters();a.qinc.splice(1,1);assert.equal(trailingRecord(a),null);
 const b=quarters();b.qinc[1].reportedCurrency='EUR';assert.equal(trailingRecord(b),null);
 const c=quarters();c.qinc[1].period='Q3';assert.equal(trailingRecord(c),null);
 const d=quarters();d.qinc[3].date='2026-12-30';assert.equal(trailingRecord(d),null);
});

test('older quarterly history does not override a more recent annual period',()=>{
 const data=quarters();data.inc=[fy(2026)];
 assert.equal(trailingRecord(data),null);
});

test('missing quarterly cash flow remains blank without discarding available trailing earnings',()=>{
 const data=quarters();data.qcf.splice(0,1);
 const t=trailingRecord(data);assert.ok(t);assert.equal(t.i.netIncome,80);assert.equal(t.c.freeCashFlow,null);
 assert.equal(periodMetrics(t).fcfPerShare,null);
 assert.ok(sheetWarnings(data,annualRecords(data),t).some(w=>w.includes('trailing cash-flow')));
});

test('cash outflows are displayed positively and diluted share calculations preserve missing values',()=>{
 const p={i:fy(2025),b:{totalStockholdersEquity:50},c:{capitalExpenditure:-5,commonDividendsPaid:-2,commonStockRepurchased:-7,freeCashFlow:15},k:{returnOnInvestedCapital:.2}};
 const m=periodMetrics(p);assert.equal(m.capex,5);assert.equal(m.repurchases,7);assert.equal(m.dividends,2);
 assert.equal(m.fcfPerShare,1.5);assert.equal(m.dividendsPerShare,.2);assert.equal(m.roic,.2);
 assert.equal(m.cash,null);assert.equal(m.debt,null);assert.equal(m.netDebt,null);
 const bad=periodMetrics({...p,i:{...p.i,weightedAverageShsOutDil:100}});
 assert.equal(bad.shareBasisConsistent,false);assert.equal(bad.fcfPerShare,null);assert.equal(bad.eps,2);
});

test('growth uses actual fiscal-year distance and rejects nonpositive or mismatched bases',()=>{
 const records=annualRecords({inc:[fy(2020,{revenue:100,epsDiluted:-1}),fy(2025,{revenue:200,epsDiluted:2})]});
 const elapsed=(Date.parse('2025-12-31')-Date.parse('2020-12-31'))/(365.25*86400000);
 near(growthRate(records,'revenue',5),2**(1/elapsed)-1);
 assert.equal(growthRate(records,'revenue',1),null);assert.equal(growthRate(records,'eps',5),null);
 records[0].currency='EUR';assert.equal(growthRate(records,'revenue',5),null);
});

test('current multiples use the current quote and withhold currency and ADR mismatches',()=>{
 const period=trailingRecord(quarters()),base={price:160,quote:{marketCap:1600},prof:{currency:'USD'}};
 near(currentValuation(base,period).pe,20);near(currentValuation(base,period).fcfYield,60/1600);
 assert.equal(currentValuation({...base,prof:{currency:'JPY'}},period).pe,null);
 assert.equal(currentValuation({...base,prof:{currency:'USD',isAdr:true}},period).fcfYield,null);
 assert.equal(currentValuation({...base,prof:{}},period).pe,null);
});

test('bank headlines avoid treating operating cash flow as industrial-company FCF yield',()=>{
 const p=trailingRecord(quarters()),d={price:160,quote:{marketCap:1600},prof:{currency:'USD',industry:'Banks - Diversified'}};
 const v=currentValuation(d,p);assert.equal(v.fcfYield,null);near(v.priceBook,1600/130);
 assert.ok(sheetWarnings(d,annualRecords(quarters()),p).some(w=>w.includes('banks and insurers')));
});

test('stock detail fetch keeps partial source failures visible and preserves chronology',async()=>{
 const oldFetch=globalThis.fetch;
 try {
  globalThis.fetch=async url=>{
   const u=new URL(url);
   if(u.pathname.endsWith('/balance-sheet-statement'))return new Response('{}',{status:503});
   const d=u.pathname.endsWith('/profile')?[{companyName:'Test',currency:'USD',price:100}]:u.pathname.endsWith('/income-statement')?[fy(2025),fy(2024)]:u.pathname.endsWith('/historical-price-eod/full')?[{date:'2026-09-04',close:100},{date:'2026-09-03',close:99}]:[];
   return new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});
  };
  const d=await fetchStockDetail('TEST','test-key');
  assert.equal(d.price,100);assert.deepEqual(d.years,['2024','2025']);assert.equal(d.longHist[0].date,'2026-09-03');
  assert.deepEqual(d.bs,[]);assert.equal(d.sources.find(s=>s.id==='bs').status,'Unavailable');
  assert.ok(d.sources.every(s=>!s.endpoint.includes('test-key')));
  await assert.rejects(()=>fetchStockDetail('../unsafe','test-key'));
 } finally {globalThis.fetch=oldFetch;}
});
