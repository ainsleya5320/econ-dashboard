import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {DEFAULT_PROPERTY, loanConstant, propertyAnalysis} from '../src/lib/propertyAnalysis.js';
import {parseHousingStock, parsePermits, joinMetroData} from '../server/metroComparison.js';

test('zero-rate loan amortizes principal and a 7% 30-year loan has the expected payment',()=>{
  assert.equal(loanConstant(0,30),1/30);
  assert.ok(Math.abs(loanConstant(7,30)*100000/12-665.302495)<.001);
  assert.equal(loanConstant(-1,30),null);
});
test('default property has positive cash flow but a $1.55m refinancing gap including fees',()=>{
  const a=propertyAnalysis(DEFAULT_PROPERTY);
  assert.equal(a.noi,500000);assert.equal(a.loan,5000000);assert.equal(a.equityGap,1550000);
  assert.equal(a.binding,'Property value / LTV');assert.ok(a.cashFlow>60000&&a.cashFlow<62000);
  assert.equal(a.cashFlow,a.noi-a.debtService-DEFAULT_PROPERTY.reserves);
  assert.ok(a.dscr>=DEFAULT_PROPERTY.minDscr);
});
test('higher borrowing rates bind income and higher cap rates or expenses cannot improve proceeds',()=>{
  const base=propertyAnalysis(DEFAULT_PROPERTY), high=propertyAnalysis({...DEFAULT_PROPERTY,interest:10});
  assert.equal(high.binding,'Income / debt coverage');assert.ok(high.equityGap>base.equityGap);
  assert.ok(Math.abs(high.dscr-DEFAULT_PROPERTY.minDscr)<1e-10);
  for(const [key,value] of [['capRate',9],['operatingExpenses',500000]]) assert.ok(propertyAnalysis({...DEFAULT_PROPERTY,[key]:value}).loan<base.loan);
});
test('nonpositive NOI, blank inputs and zero debt are handled without fictitious loan proceeds',()=>{
  const loss=propertyAnalysis({...DEFAULT_PROPERTY,operatingExpenses:2000000});
  assert.equal(loss.loan,0);assert.equal(loss.value,0);assert.equal(loss.equityGap,DEFAULT_PROPERTY.debt);assert.ok(loss.cashFlow<0);
  assert.equal(propertyAnalysis({...DEFAULT_PROPERTY,monthlyRent:NaN}),null);
  assert.equal(propertyAnalysis({}),null);
  assert.equal(propertyAnalysis({...DEFAULT_PROPERTY,vacancy:101}),null);
  assert.equal(propertyAnalysis({...DEFAULT_PROPERTY,debt:0}).equityGap,0);
});
test('Census metropolitan classification includes standalone metros and treats missing counts as missing',()=>{
  const rows=[['CSA','CBSA','Name','Metro /Micro Code','Total','1 Unit','2 Units','3 and 4 Units','5 Units or More'],[999,12420,'Austin',4,27322,14810,676,87,11749],[1,42660,'Seattle',2,15659,5000,100,100,10459],[999,12380,'Austin MN',5,136,34,0,0,102],[1,31080,'Los Angeles',2,null,0,0,0,0]];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'MSA Units Ann');
  const p=parsePermits(XLSX.write(wb,{type:'buffer',bookType:'xls'}));
  assert.equal(p['12420'].total,27322);assert.equal(p['42660'].total,15659);assert.equal(p['12380'],undefined);assert.equal(p['31080'].total,null);
  const s=parseHousingStock('GEO_ID|B25001_E001|B25001_M001\n310M700US12420|1127379|380\n310M700US42660|-666666666|');
  assert.equal(s['12420'].units,1127379);assert.equal(s['42660'].units,null);
  const joined=joinMetroData(p,{'12420':{total:32294}},s,{asOf:'2026-07-31',metros:[{name:'Austin, TX',zoriYoy:-.8}]}).find(r=>r.code==='12420');
  assert.ok(Math.abs(joined.permitsPer1000-24.235)<.001);assert.equal(joined.rentGrowth,-.8);assert.ok(joined.permitsChange<0);
});
