import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChain,quoteQuality,chooseCandidates,payoffCase,europeanPrice,americanPrice,normalCdf,smileDistribution,distributionQuantile,distributionAbove,constantMaturityIv,realizedHistory,earningsWindows,eventsForExpiry,number} from '../src/lib/optionsAnalysis.js';
import {normalizeEvents} from '../server/optionsContext.js';

const option=(overrides={})=>({sym:'TEST',root:'TEST',type:'P',strike:90,bid:2,ask:2.1,iv:.2,oi:100,delta:-.25,dte:30,expiryDate:'2026-10-07',standard:true,...overrides});
const near=(actual,expected,tolerance=.001)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} ≠ ${expected}`);

test('chain normalization keeps exact calendar dates, metadata, missing IV and contract roots',()=>{
 const raw={timestamp:'2026-09-07 10:00:00',data:{current_price:100,last_trade_time:'2026-09-04T16:00:00',options:[
 {option:'TEST260908P00090000',bid:2,ask:2.1,iv:null,open_interest:100,last_trade_time:'2026-09-01'},
 {option:'TEST1261007C00110000',bid:1,ask:1.1,iv:.2,open_interest:100},
 {option:'TEST260907P00090000',bid:2,ask:2.1},{option:'invalid'}]}};
 const c=normalizeChain(raw,'TEST','2026-09-07');
 assert.equal(c.options.length,2);assert.equal(c.options[0].dte,1);assert.equal(c.options[0].expiryDate,'2026-09-08');
 assert.equal(c.options[0].iv,null);assert.equal(c.options[1].standard,false);
 assert.equal(c.options[0].lastTime,'2026-09-01');assert.equal(c.sourceTimestamp,raw.timestamp);
 assert.equal(c.underlyingLastTrade,raw.data.last_trade_time);
 assert.equal(number(''),null);assert.equal(number('  '),null);assert.equal(number('0'),0);
});

test('quote checks reject crossed, one-sided, wide, thin and adjusted contracts',()=>{
 assert.equal(quoteQuality(option()).usable,true);
 for(const override of [{bid:0},{ask:null},{ask:1},{ask:5},{oi:10},{oi:null},{standard:false}])assert.equal(quoteQuality(option(override)).usable,false,JSON.stringify(override));
 assert.equal(quoteQuality(option({oi:10,ask:3}),{minOi:0,maxSpread:.5}).usable,true);
});

test('valuation matching includes the fee and uses a deterministic strike order',()=>{
 const chain={spot:100,options:[option(),option({sym:'P2',strike:91}),option({sym:'C1',type:'C',strike:110}),option({sym:'BAD',bid:0})]};
 const result=chooseCandidates(chain,{expiryDate:'2026-10-07',buyBelow:88,sellAbove:110,fee:1,contracts:2});
 assert.equal(result.length,3);assert.equal(result.find(o=>o.sym==='TEST').matches,false);
 near(result.find(o=>o.sym==='TEST').entry,88.01);near(result[0].premium,398);
 assert.equal(result.find(o=>o.sym==='C1').matches,true);
 const matched=chooseCandidates(chain,{expiryDate:'2026-10-07',buyBelow:89.01,sellAbove:110,fee:1});
 assert.deepEqual(matched.filter(o=>o.type==='P').map(o=>o.strike),[91,90]);
});

test('expiry payoffs expose put losses, covered-call caps and equal capital',()=>{
 const args={spot:100,put:option(),call:option({type:'C',strike:110,bid:3}),fee:0,days:30};
 const loss=payoffCase({...args,terminal:60});
 assert.equal(loss.capital,10000);assert.equal(loss.shortPut,-2800);assert.equal(loss.stocks,-4000);assert.equal(loss.coveredCall,-3700);
 assert.equal(payoffCase({...args,terminal:100}).shortPut,200);
 const rally=payoffCase({...args,terminal:140});assert.equal(rally.stocks,4000);assert.equal(rally.coveredCall,1300);
 assert.equal(payoffCase({...args,terminal:0}).shortPut,-8800);
});

test('fees, cash interest and dividends use equal starting balances',()=>{
 const p=payoffCase({spot:100,terminal:100,put:option({strike:110}),call:option({type:'C',strike:110,bid:3}),contracts:2,fee:1,days:365,cashRate:5,dividendPerShare:2});
 assert.equal(p.capital,22000);assert.equal(p.cash,1100);assert.equal(p.stocks,500);
 assert.equal(p.shortPut,-502);assert.equal(p.coveredCall,1098);
 for(const overrides of [{terminal:-1},{contracts:1.5},{fee:-1},{spot:0},{put:{strike:90,bid:null}}])assert.equal(payoffCase({spot:100,terminal:100,...overrides}),null);
});

test('option models agree with known European values and allow early exercise',()=>{
 const a={spot:100,strike:100,years:1,iv:.2,rate:.05,dividend:0};
 near(europeanPrice(a),10.4506,.001);
 near(europeanPrice({...a,type:'P'}),5.5735,.001);
 const americanPut=americanPrice({...a,type:'P'},400);
 assert.ok(americanPut>europeanPrice({...a,type:'P'}));
 near(americanPrice(a,400),europeanPrice(a),.01);
 assert.ok(americanPrice({...a,type:'P',spot:80})>americanPut);
 assert.ok(americanPrice({...a,type:'P',iv:.35})>americanPut);
 assert.equal(europeanPrice({...a,years:0,spot:120}),20);
 assert.equal(americanPrice({...a,spot:-1}),null);
});

function flatSmile() {
 return Array.from({length:61},(_,i)=>option({strike:70+i,type:70+i<=100?'P':'C',dte:90,expiryDate:'2026-12-06',iv:.25}));
}
test('a flat volatility surface recovers lognormal pricing weights without tail extrapolation',()=>{
 const c=smileDistribution(flatSmile(),90,100,.04,.01);
 assert.ok(c);assert.ok(c.adjustment<1e-8);
 const d2=(Math.log(100/100)+(.04-.01-.25**2/2)*(90/365))/(.25*Math.sqrt(90/365));
 near(distributionAbove(c,100),normalCdf(d2),.002);
 near(distributionQuantile(c,.5),100*Math.exp((.04-.01-.25**2/2)*90/365),.02);
 assert.equal(distributionAbove(c,200),null);assert.equal(distributionQuantile(c,.999999),null);
 assert.ok(c.pts.every((p,i)=>p.cdf>=0&&p.cdf<=1&&(!i||p.cdf>=c.pts[i-1].cdf)));
});
test('thin or severely inconsistent surfaces are withheld',()=>{
 assert.equal(smileDistribution(flatSmile().slice(0,7),90,100,.04,.01),null);
 assert.equal(smileDistribution(flatSmile().map((o,i)=>({...o,iv:i%2?.05:1.5})),90,100,.04,.01),null);
 assert.equal(smileDistribution(flatSmile(),90,100,null,.01),null);
});

test('constant maturity interpolates total variance and never substitutes an unbracketed expiry',()=>{
 const rows=[option({strike:100,dte:20,iv:.2}),option({strike:100,dte:40,iv:.4})];
 near(constantMaturityIv(rows,100),Math.sqrt((.5*.2**2*20+.5*.4**2*40)/30),1e-12);
 assert.equal(constantMaturityIv(rows.slice(0,1),100),null);
 assert.equal(constantMaturityIv(rows.map(o=>({...o,strike:50})),100),null);
 near(constantMaturityIv([option({strike:100,dte:30,iv:.3})],100),.3);
});

test('historical volatility needs observations and earnings windows do not use remote dates',()=>{
 assert.deepEqual(realizedHistory([{date:'2026-01-01',close:100}]),[]);
 const prices=Array.from({length:25},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,close:100*Math.exp(.01*i)}));
 const rv=realizedHistory(prices);assert.equal(rv.length,4);near(rv.at(-1).rv,0,1e-10);
 const windows=earningsWindows([{date:'2026-01-10'},{date:'2026-03-01'}],prices);
 assert.equal(windows[0].from,'2026-01-09');assert.equal(windows[0].to,'2026-01-11');near(windows[0].move,(Math.exp(.02)-1)*100);
 assert.equal(windows[1].move,null);
});

test('event normalization preserves ex-dividend dates and leaves undeclared dividends unknown',()=>{
 const data=normalizeEvents([{date:'2026-10-29',epsEstimated:2},{date:'2026-07-30',time:'amc'}],[{date:'2026-08-10',paymentDate:'2026-08-13',dividend:.27,adjDividend:.27}], '2026-09-07');
 assert.equal(data.events.length,1);assert.equal(data.events[0].type,'Earnings');assert.equal(data.events[0].timing,null);
 assert.equal(data.events[0].epsEstimated,undefined);assert.equal(data.dividends[0].date,'2026-08-10');assert.equal(data.dividends[0].paymentDate,'2026-08-13');
 assert.equal(data.pastEarnings.length,1);
 assert.equal(eventsForExpiry(data.events,'2026-10-20','2026-09-07').length,0);
 assert.equal(eventsForExpiry(data.events,'2026-10-29','2026-09-07').length,1);
});
