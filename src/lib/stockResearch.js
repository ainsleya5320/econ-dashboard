export const numeric = v => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
export const ratio = (a,b) => numeric(a)!==null && numeric(b)>0 ? Number(a)/Number(b) : null;
export const difference = (a,b) => numeric(a)!==null && numeric(b)!==null ? Number(a)-Number(b) : null;
const absolute = v => numeric(v)===null ? null : Math.abs(Number(v));
const samePeriod = (a,b) => a?.date===b?.date && String(a?.fiscalYear)===String(b?.fiscalYear) && a?.period===b?.period && !!a?.reportedCurrency && a.reportedCurrency===b?.reportedCurrency;
export function uniquePeriods(rows=[]) {
  const found=new Map();
  [...(Array.isArray(rows)?rows:[])].filter(r=>r?.date&&r?.fiscalYear).sort((a,b)=>(a.acceptedDate||a.filingDate||'').localeCompare(b.acceptedDate||b.filingDate||'')).forEach(r=>found.set([r.date,r.fiscalYear,r.period,r.reportedCurrency].join('|'),r));
  return [...found.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
const match=(rows,i)=>uniquePeriods(rows).find(r=>samePeriod(i,r))||{};
export function annualRecords(data) {
  return uniquePeriods(data.inc).filter(i=>i.period==='FY').map(i=>({date:i.date,year:String(i.fiscalYear),currency:i.reportedCurrency,period:'FY',i,b:match(data.bs,i),c:match(data.cf,i),r:match(data.rat,i),k:match(data.km,i)}));
}
export function quarterRecords(data) {
  return uniquePeriods(data.qinc).filter(i=>/^Q[1-4]$/.test(i.period)).map(i=>({date:i.date,year:String(i.fiscalYear),currency:i.reportedCurrency,period:i.period,i,b:match(data.qbs,i),c:match(data.qcf,i),r:{},k:{}}));
}
const sumField=(rows,key)=>rows.length&&rows.every(r=>numeric(r[key])!==null)?rows.reduce((n,r)=>n+Number(r[key]),0):null;
export function trailingRecord(data) {
  const quarters=quarterRecords(data).slice(-4);
  if(quarters.length!==4)return null;
  const lastAnnual=uniquePeriods(data.inc).filter(i=>i.period==='FY').at(-1);
  if(lastAnnual&&quarters.at(-1).date<lastAnnual.date)return null;
  const serial=q=>Number(q.year)*4+Number(q.period.slice(1));
  if(quarters.some((q,index)=>!q.currency||q.currency!==quarters[0].currency||(index&&(serial(q)!==serial(quarters[index-1])+1||Date.parse(q.date)-Date.parse(quarters[index-1].date)<45*86400000||Date.parse(q.date)-Date.parse(quarters[index-1].date)>140*86400000))))return null;
  const incFields=['revenue','grossProfit','operatingIncome','ebitda','netIncome','incomeBeforeTax','incomeTaxExpense','interestExpense','epsDiluted','researchAndDevelopmentExpenses','depreciationAndAmortization'];
  const cfFields=['operatingCashFlow','capitalExpenditure','freeCashFlow','commonDividendsPaid','commonStockRepurchased','stockBasedCompensation'];
  const i=Object.fromEntries(incFields.map(k=>[k,sumField(quarters.map(q=>q.i),k)]));
  const shares=sumField(quarters.map(q=>q.i),'weightedAverageShsOutDil');i.weightedAverageShsOutDil=shares===null?null:shares/4;
  const c=Object.fromEntries(cfFields.map(k=>[k,sumField(quarters.map(q=>q.c),k)]));
  return {...quarters.at(-1),period:'TTM',year:'TTM',i,c,k:{},r:{},quarters:quarters.map(q=>q.date)};
}
export function periodMetrics(p) {
  if(!p)return {};
  const {i={},b={},c={},k={}}=p,shares=numeric(i.weightedAverageShsOutDil),eps=numeric(i.epsDiluted),impliedEps=ratio(i.netIncome,shares);
  const consistent=eps===null||impliedEps===null||Math.abs(eps-impliedEps)<=Math.max(.03,Math.abs(eps)*.05);
  const perShare=v=>consistent?ratio(v,shares):null;
  const equity=numeric(b.totalStockholdersEquity),cash=numeric(b.cashAndCashEquivalents),debt=numeric(b.totalDebt);
  return {revenue:numeric(i.revenue),eps,shares,revenuePerShare:perShare(i.revenue),fcfPerShare:perShare(c.freeCashFlow),dividendsPerShare:perShare(absolute(c.commonDividendsPaid)),
    grossMargin:ratio(i.grossProfit,i.revenue),operatingMargin:ratio(i.operatingIncome,i.revenue),netMargin:ratio(i.netIncome,i.revenue),
    netIncome:numeric(i.netIncome),operatingIncome:numeric(i.operatingIncome),ebitda:numeric(i.ebitda),cfo:numeric(c.operatingCashFlow),fcf:numeric(c.freeCashFlow),capex:absolute(c.capitalExpenditure),
    fcfMargin:ratio(c.freeCashFlow,i.revenue),cashConversion:ratio(c.freeCashFlow,i.netIncome),sbc:numeric(c.stockBasedCompensation),sbcSales:ratio(c.stockBasedCompensation,i.revenue),
    repurchases:absolute(c.commonStockRepurchased),dividends:absolute(c.commonDividendsPaid),equity,cash,debt,netDebt:difference(debt,cash),liquidAssets:numeric(b.cashAndShortTermInvestments),
    workingCapital:difference(b.totalCurrentAssets,b.totalCurrentLiabilities),roic:numeric(k.returnOnInvestedCapital),roe:numeric(k.returnOnEquity),currentRatio:ratio(b.totalCurrentAssets,b.totalCurrentLiabilities),
    interestCoverage:ratio(i.operatingIncome,i.interestExpense),shareBasisConsistent:consistent};
}
export function growthRate(records,metric,years) {
  const latest=records.at(-1);if(!latest)return null;
  const earlier=records.find(p=>Number(p.year)===Number(latest.year)-years);
  if(!earlier||!latest.currency||latest.currency!==earlier.currency)return null;
  const from=periodMetrics(earlier)[metric],to=periodMetrics(latest)[metric];
  const elapsed=(Date.parse(latest.date)-Date.parse(earlier.date))/(365.25*86400000);
  if(!(from>0)||!(to>0)||Math.abs(elapsed-years)>.2)return null;
  return (to/from)**(1/elapsed)-1;
}
export const isBankOrInsurer = data => /bank|insurance/i.test(data.prof?.industry||'');
export function currentValuation(data,period) {
  const m=periodMetrics(period),price=numeric(data.price),cap=numeric(data.quote?.marketCap??data.prof?.marketCap??data.prof?.mktCap);
  const quoteCurrency=data.prof?.currency;
  const comparable=!!quoteCurrency&&!!period?.currency&&quoteCurrency===period.currency&&!data.prof?.isAdr;
  return {price,cap,pe:comparable?ratio(price,m.eps):null,priceBook:comparable?ratio(cap,m.equity):null,fcfYield:comparable&&!isBankOrInsurer(data)?ratio(m.fcf,cap):null,salesMultiple:comparable?ratio(cap,m.revenue):null,dividendYield:comparable?ratio(m.dividends,cap):null,comparable};
}
export function sheetWarnings(data,annual,ttm) {
  const warnings=[];
  const latest=annual.at(-1);
  if(!annual.length)warnings.push('Annual financial statements are unavailable.');
  if(!ttm)warnings.push('Trailing figures require four consecutive quarters ending no earlier than the latest annual statement. Annual figures are shown when that test fails.');
  if(annual.some(p=>!p.b.date||!p.c.date))warnings.push('Some statement periods do not align. Affected cells remain blank.');
  if(ttm&&(!ttm.b.date||ttm.c.freeCashFlow===null))warnings.push('Some trailing cash-flow or balance-sheet observations are missing. Affected trailing figures remain blank.');
  if(new Set(annual.map(p=>p.currency)).size>1)warnings.push('Reporting currency changes across this history. Growth rates and charts require comparable currencies.');
  if(annual.some(p=>!periodMetrics(p).shareBasisConsistent))warnings.push('Some EPS and share counts do not reconcile. Derived per-share figures are withheld in affected years.');
  if(data.prof?.isAdr)warnings.push('ADR share ratios are not verified. Current per-share valuation multiples are withheld.');
  if(isBankOrInsurer(data))warnings.push('For banks and insurers, lending, deposits and regulatory obligations change the meaning of cash flow and liquidity. The headline uses price/book and ROE; reported FCF and net debt below are not industrial-company valuation measures.');
  if(latest&&data.prof?.currency!==latest.currency)warnings.push('Trading and reporting currencies differ or are missing. Current valuation ratios are withheld.');
  return warnings;
}
