import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {parseAcsTable,householdChange,parseZillowHistory,combinePriceRentHistory,parseMonthlyPermits,latestPermitPeriod} from '../server/localMarketData.js';

test('ACS suppression stays missing and metro matches do not include counties',()=>{
  const d=parseAcsTable('GEO_ID|B25119_E003|B25119_M003\n310M700US12420|70008|1922\n310M700US42660|-666666666|\n0500000US12420|10|1','B25119',['003']);
  assert.equal(d['12420']['003'].value,70008);assert.equal(d['42660']['003'].value,null);assert.equal(d['42660']['003'].moe,null);
  assert.throws(()=>parseAcsTable('GEO_ID|wrong','B25119',['003']));
});
test('household growth distinguishes a point estimate from a change larger than survey error',()=>{
  const clear=householdChange({value:1061155,moe:6067},{value:1036074,moe:5494});
  assert.equal(clear.change,25081);assert.ok(Math.abs(clear.growth-2.420773)<.000001);assert.equal(clear.clear,true);
  assert.equal(householdChange({value:10100,moe:500},{value:10000,moe:500}).clear,false);
  assert.equal(householdChange({value:10100,moe:null},{value:10000,moe:500}).clear,null);
  assert.equal(householdChange({value:10100},{value:0}).growth,null);
});
test('Zillow CSV quoting, missing observations and independent price/rent histories are preserved',()=>{
  const csv='RegionID,SizeRank,RegionName,RegionType,StateName,2024-01-31,2024-04-30,2025-01-31\n1,0,United States,country,,100,101,110\n2,1,"Austin, TX",msa,TX,100,,120\n3,2,"Seattle, WA",msa,WA,200,205,210';
  const rows=parseZillowHistory(csv,new Set(['Austin, TX']));
  assert.equal(rows['Austin, TX'].length,2);assert.equal(rows.US.length,3);assert.equal(rows['Seattle, WA'],undefined);
  const joined=combinePriceRentHistory(rows['Austin, TX'],[{date:'2024-04-30',value:500000}]);
  assert.equal(joined.find(p=>p.date==='2024-04').rent,null);
  assert.equal(joined.find(p=>p.date==='2025-01').price,null);
  assert.ok(Math.abs(joined.find(p=>p.date==='2025-01').rentYoy-20)<1e-10);
  assert.equal(joined.find(p=>p.date==='2025-01').rentMomentum,null);
});
test('three-month pace compounds four times and uses calendar months, not row offsets',()=>{
  const points=[{date:'2024-01-31',value:100},{date:'2024-04-30',value:102}];
  const p=combinePriceRentHistory(points).at(-1);
  assert.ok(Math.abs(p.rentMomentum-100*(1.02**4-1))<1e-10);assert.equal(p.rentYoy,null);
});
test('monthly permits use YTD unit columns, not current-month counts or structure counts',()=>{
  const header=['CSA','CBSA','Name','Metro /Micro Code','Total','1 Unit','2 Units','3 and 4 Units','5 Units or More','Structures',null,'Total','1 Unit','2 Units','3 and 4 Units','5 Units or More','Structures'];
  const rows=[header,[999,12420,'Austin',4,20,10,2,0,8,1,null,13094,9602,200,94,3198,50],[1,42660,'Seattle',2,10,5,0,0,5,1,null,null,12,0,0,null,2]];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'MSA Units');
  const d=parseMonthlyPermits(XLSX.write(book,{type:'buffer',bookType:'xls'}));
  assert.deepEqual(d['12420'],{total:13094,single:9602,small:294,multi:3198});assert.equal(d['42660'].total,null);
});
test('release discovery chooses latest available valid month and excludes future links',()=>{
  const html='cbsamonthly_202606.xls cbsamonthly_202607.xls cbsamonthly_202699.xls cbsamonthly_202710.xls';
  assert.equal(latestPermitPeriod(html,'202609'),'202607');assert.equal(latestPermitPeriod('no links','202609'),null);
});
