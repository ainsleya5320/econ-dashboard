import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverRentReport,parseConcessionReport} from '../server/rentalConcessions.js';
import {selectEmploymentSeries,parseBlsSeries,employmentHistory,summarizeEmployment} from '../server/metroEmployment.js';
import {effectiveRent,rentalTypeComparison} from '../src/lib/rentalAnalysis.js';

test('rental report discovery dates observations from report month and rejects future links',()=>{
  const html='<a href="https://www.zillow.com/research/july-2026-rent-report-36631/">July</a><a href="https://www.zillow.com/research/august-2026-rent-report-36632/">August</a><a href="https://www.zillow.com/research/october-2026-rent-report-36633/">Future</a>';
  assert.equal(discoverRentReport(html,new Date('2026-09-07')).period,'2026-08');
  assert.throws(()=>discoverRentReport('No report'));
});
test('concessions are read by column name, with missing shares preserved and source dates retained',()=>{
  const table='<script>{"datePublished":"2026-08-18T12:00:28+00:00"}</script><table><tr><th>Metro</th><th>Concession Share</th><th>Rent Year over Year</th></tr><tr><td>United States</td><td>39.8 %</td><td>2.3%</td></tr><tr><td><b>Austin, TX</b></td><td>65.1&nbsp;%</td><td>-0.9%</td></tr><tr><td>Seattle, WA</td><td>—</td><td>1.4%</td></tr><tr><td>Invalid, US</td><td>101%</td><td>2%</td></tr></table>';
  const data=parseConcessionReport(table,{url:'https://www.zillow.com/research/july-2026-rent-report-36631/',period:'2026-07'});
  assert.deepEqual(data.shares,{US:39.8,'Austin, TX':65.1});assert.equal(data.publishedAt,'2026-08-18');assert.equal(data.period,'2026-07');
  assert.throws(()=>parseConcessionReport('<table><tr><td>Rent</td></tr></table>',{period:'2026-07'}));
});
test('one month free on twelve months produces eleven months of total rent',()=>{
  assert.deepEqual(effectiveRent(2400,12,1),{monthly:2200,total:26400,discount:100/12});
  assert.deepEqual(effectiveRent(2000,12,0),{monthly:2000,total:24000,discount:0});
  assert.equal(effectiveRent(2000,12,13),null);assert.equal(effectiveRent(NaN,12,1),null);assert.equal(effectiveRent(2000,0,1),null);assert.equal(effectiveRent(2000,12,-1),null);
});
test('property type growth gaps require observations from the same latest month',()=>{
  const focus={rentTypes:{single:{history:[{date:'2026-06',rentYoy:2},{date:'2026-07',rentYoy:3}]},multi:{history:[{date:'2026-06',rentYoy:-1}]}}};
  assert.equal(rentalTypeComparison(focus).gap,null);
  focus.rentTypes.multi.history.push({date:'2026-07',rentYoy:-1});assert.equal(rentalTypeComparison(focus).gap,4);
});
const metadata=industries=>['series_id\tarea_code\tindustry_code\tdata_type_code\tseasonal',...industries.map(i=>`id${i}\t12420\t${i}\t01\tU`),'wrongSeason\t12420\t50000000\t01\tS','wrongArea\t42660\t50000000\t01\tU'].join('\n');
test('industry selection avoids counting mining and construction both separately and together',()=>{
  const all=selectEmploymentSeries(metadata(['00000000','10000000','15000000','20000000','50000000']),'12420');
  assert.deepEqual(all.sectors.map(s=>s.code),['10000000','20000000','50000000']);
  const combined=selectEmploymentSeries(metadata(['00000000','15000000','20000000','50000000']),'12420');
  assert.deepEqual(combined.sectors.map(s=>s.code),['15000000','50000000']);
  assert.throws(()=>selectEmploymentSeries(metadata(['00000000']),'99999'));
});
test('BLS annual averages, suppressed values and preliminary flags are handled explicitly',()=>{
  const data=parseBlsSeries({status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:'jobs',data:[{year:'2026',period:'M07',value:'1421.7',footnotes:[{code:'P'}]},{year:'2026',period:'M13',value:'1400'},{year:'2026',period:'M06',value:'-'},{year:'2025',period:'M07',value:'1397.9'}]}]}});
  assert.equal(data.jobs.length,2);assert.equal(data.jobs.at(-1).preliminary,true);
  assert.ok(Math.abs(employmentHistory(data.jobs).at(-1).yoy-1.7025538307461119)<1e-9);
  assert.equal(employmentHistory([{date:'2025-06',value:10},{date:'2026-07',value:11}]).at(-1).yoy,null);
  assert.throws(()=>parseBlsSeries({status:'REQUEST_NOT_PROCESSED'}));
});
test('employment joins industry and national observations on the metro month and converts thousands to jobs',()=>{
  const series={total:[{date:'2025-07',value:100},{date:'2026-07',value:105}],sector:[{date:'2025-07',value:20},{date:'2026-07',value:22}],missing:[{date:'2026-06',value:30}],CEU0000000001:[{date:'2025-07',value:1000},{date:'2026-07',value:1010},{date:'2026-08',value:1015}]};
  const d=summarizeEmployment(series,{total:'total',sectors:[{id:'sector',code:'50000000'},{id:'missing',code:'55000000'}]});
  assert.equal(d.latest.jobs,105000);assert.equal(d.latest.change,5000);assert.ok(Math.abs(d.latest.nationalYoy-1)<1e-9);
  assert.equal(d.sectors[0].change,2000);assert.equal(d.sectors[0].contribution,2);assert.equal(d.sectors[1].jobs,null);assert.equal(d.partial,true);
});
