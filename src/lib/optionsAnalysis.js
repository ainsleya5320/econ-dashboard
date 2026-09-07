export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const number = v => v != null && String(v).trim()!=='' && Number.isFinite(Number(v)) ? Number(v) : null;
export const dateOnly = v => typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10):null;
export const todayNY = () => {const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
export const daysBetween = (a,b) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);

export function normalizeChain(j,ticker,today=todayNY()) {
  const raw=j.data?.options||[];
  const options=raw.map(o=>{
    const sym=o.option||'',m=sym.match(/^(.*?)(\d{6})([CP])(\d{8})$/);if(!m)return null;
    const [,root,dt,type,k]=m,expiryDate=`20${dt.slice(0,2)}-${dt.slice(2,4)}-${dt.slice(4)}`;
    if(!Number.isFinite(Date.parse(expiryDate)))return null;
    return {sym,root,type,strike:number(o.strike)??Number(k)/1000,expiryDate,expiry:new Date(expiryDate+'T00:00:00Z'),dte:daysBetween(today,expiryDate),
      iv:number(o.iv),bid:number(o.bid),ask:number(o.ask),bidSize:number(o.bid_size),askSize:number(o.ask_size),oi:number(o.open_interest),vol:number(o.volume),
      delta:number(o.delta),gamma:number(o.gamma),vega:number(o.vega),theta:number(o.theta),rho:number(o.rho),theo:number(o.theo),lastPrice:number(o.last_trade_price),lastTime:o.last_trade_time??null,
      prevClose:number(o.prev_day_close),change:number(o.change),pctChange:number(o.percent_change),standard:root===ticker};
  }).filter(o=>o&&o.strike>0&&o.dte>0);
  return {options,spot:number(j.data?.current_price),symbol:ticker,sourceTimestamp:j.timestamp??null,underlyingLastTrade:j.data?.last_trade_time??null,retrievedAt:new Date().toISOString(),valuationDate:today,source:'Cboe delayed quotes'};
}

export function quoteQuality(o,{maxSpread=.35,minOi=50}={}) {
  const reasons=[];
  if(!(o.bid>0)||!finite(o.ask)||o.ask<o.bid)reasons.push('No valid two-sided quote');
  const mid=finite(o.bid)&&finite(o.ask)?(o.bid+o.ask)/2:null;
  const spread=mid>0?(o.ask-o.bid)/mid:null;
  if(spread!=null&&spread>maxSpread)reasons.push('Wide bid–ask spread');
  if(!finite(o.oi)||o.oi<minOi)reasons.push('Low or missing open interest');
  if(o.standard===false)reasons.push('Nonstandard or different contract root');
  return {usable:!reasons.length,reasons,spread,mid};
}
export const usableOptions = (chain,settings) => (chain?.options||[]).filter(o=>quoteQuality(o,settings).usable);

export function chooseCandidates(chain,{expiryDate,buyBelow,sellAbove,fee=0,contracts=1,...filters}) {
  const eligible=usableOptions(chain,filters).filter(o=>o.expiryDate===expiryDate);
  return eligible.map(o=>{
    const entry=o.strike-o.bid+fee/100;
    const matches=o.type==='P'?finite(buyBelow)&&entry<=buyBelow:finite(sellAbove)&&o.strike>=sellAbove;
    return {...o,entry,matches,spread:quoteQuality(o,filters).spread,premium:contracts*(100*o.bid-fee),collateral:o.type==='P'?100*contracts*o.strike:100*contracts*chain.spot};
  }).sort((a,b)=>a.type.localeCompare(b.type)||Number(b.matches)-Number(a.matches)||(a.type==='P'?b.strike-a.strike:a.strike-b.strike));
}

// Equal starting capital, standard 100-share contracts, held to expiration.
// Cash interest is earned only on the original cash balance, not premium proceeds.
export function payoffCase({spot,terminal,put,call,contracts=1,fee=0,days=45,cashRate=0,dividendPerShare=0}) {
  if(![spot,terminal,contracts,fee,days,cashRate,dividendPerShare].every(finite)||spot<=0||terminal<0||contracts<1||!Number.isInteger(contracts)||fee<0||days<0||cashRate<0||dividendPerShare<0)return null;
  if([put,call].some(o=>o&&(!finite(o.strike)||o.strike<=0||!finite(o.bid)||o.bid<0)))return null;
  const shares=100*contracts,capital=shares*Math.max(spot,put?.strike??0);
  const interest=balance=>balance*cashRate/100*days/365;
  const stocks=shares*(terminal-spot+dividendPerShare)+interest(capital-shares*spot);
  const cash=interest(capital);
  const shortPut=put?shares*(put.bid-Math.max(put.strike-terminal,0))-contracts*fee+interest(capital):null;
  const coveredCall=call?stocks+shares*(call.bid-Math.max(terminal-call.strike,0))-contracts*fee:null;
  return {capital,shares,cash,stocks,shortPut,coveredCall};
}

export function normalCdf(x) {
  const t=1/(1+.2316419*Math.abs(x)),d=.3989422804*Math.exp(-x*x/2);
  const p=d*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>0?1-p:p;
}
export function europeanPrice({spot,strike,years,iv,rate=0,dividend=0,type='C'}) {
  if(![spot,strike,years,iv,rate,dividend].every(finite)||spot<=0||strike<=0||years<0||iv<0)return null;
  if(years===0)return Math.max(type==='C'?spot-strike:strike-spot,0);
  if(iv===0)return Math.max(type==='C'?spot*Math.exp(-dividend*years)-strike*Math.exp(-rate*years):strike*Math.exp(-rate*years)-spot*Math.exp(-dividend*years),0);
  const d1=(Math.log(spot/strike)+(rate-dividend+iv*iv/2)*years)/(iv*Math.sqrt(years)),d2=d1-iv*Math.sqrt(years);
  return type==='C'?spot*Math.exp(-dividend*years)*normalCdf(d1)-strike*Math.exp(-rate*years)*normalCdf(d2):strike*Math.exp(-rate*years)*normalCdf(-d2)-spot*Math.exp(-dividend*years)*normalCdf(-d1);
}
export function americanPrice(args,steps=180) {
  const {spot,strike,years,iv,rate=0,dividend=0,type='C'}=args;
  if(![spot,strike,years,iv,rate,dividend].every(finite)||spot<=0||strike<=0||years<0||iv<=0)return null;
  const exercise=s=>Math.max(type==='C'?s-strike:strike-s,0);
  if(years===0)return exercise(spot);
  const dt=years/steps,u=Math.exp(iv*Math.sqrt(dt)),d=1/u,p=(Math.exp((rate-dividend)*dt)-d)/(u-d),disc=Math.exp(-rate*dt);
  if(p<0||p>1)return null;
  const values=Array.from({length:steps+1},(_,i)=>exercise(spot*Math.pow(u,i)*Math.pow(d,steps-i)));
  for(let n=steps-1;n>=0;n--)for(let i=0;i<=n;i++)values[i]=Math.max(exercise(spot*Math.pow(u,i)*Math.pow(d,n-i)),disc*(p*values[i+1]+(1-p)*values[i]));
  return values[0];
}

// Weighted isotonic fit of call-price slopes enforces nonnegative probabilities.
function increasingFit(points) {
  const blocks=[];
  points.forEach((p,i)=>{blocks.push({start:i,end:i,w:p.w,v:p.v});while(blocks.length>1&&blocks.at(-2).v>blocks.at(-1).v){const b=blocks.pop(),a=blocks.pop();blocks.push({start:a.start,end:b.end,w:a.w+b.w,v:(a.v*a.w+b.v*b.w)/(a.w+b.w)});}});
  const out=[];for(const b of blocks)for(let i=b.start;i<=b.end;i++)out[i]=b.v;return out;
}
export function smileDistribution(options,dte,spot,rate,dividend) {
  if(![spot,rate,dividend].every(finite)||dte<=0)return null;
  const T=dte/365,byStrike=new Map();
  for(const o of options){if(o.dte!==dte||!quoteQuality(o).usable||!(o.iv>0))continue;
    const otm=o.type==='P'?o.strike<=spot:o.strike>=spot,old=byStrike.get(o.strike);
    if(!old||otm&&!old.otm)byStrike.set(o.strike,{...o,otm});}
  const quoted=[...byStrike.values()].sort((a,b)=>a.strike-b.strike);if(quoted.length<8)return null;
  const calls=quoted.map(o=>({K:o.strike,price:europeanPrice({spot,strike:o.strike,years:T,iv:o.iv,rate,dividend}),iv:o.iv}));
  const slopes=calls.slice(1).map((p,i)=>({K:(p.K+calls[i].K)/2,w:p.K-calls[i].K,v:(p.price-calls[i].price)/(p.K-calls[i].K)}));
  const disc=Math.exp(-rate*T),fit=increasingFit(slopes),adjustment=Math.max(...slopes.map((p,i)=>Math.abs((Math.max(-disc,Math.min(0,fit[i]))-p.v)/disc)));
  if(adjustment>.2)return null; // Large repairs indicate an unreliable smile; withhold the distribution.
  const pts=slopes.map((p,i)=>({K:p.K,above:Math.max(0,Math.min(1,-fit[i]/disc)),cdf:1-Math.max(0,Math.min(1,-fit[i]/disc))}));
  const atm=quoted.reduce((a,b)=>Math.abs(a.strike-spot)<Math.abs(b.strike-spot)?a:b);
  return {dte,T,F:spot*Math.exp((rate-dividend)*T),pts,atmIv:atm.iv,adjustment,expiryDate:atm.expiryDate};
}
export function distributionQuantile(c,p) {
  const pts=c.pts;if(p<pts[0].cdf||p>pts.at(-1).cdf)return null;
  for(let i=1;i<pts.length;i++)if(pts[i].cdf>=p){const a=pts[i-1],b=pts[i],w=b.cdf>a.cdf?(p-a.cdf)/(b.cdf-a.cdf):0;return a.K+w*(b.K-a.K);}
  return null;
}
export function distributionAbove(c,k) {
  const pts=c.pts;if(k<pts[0].K||k>pts.at(-1).K)return null;
  for(let i=1;i<pts.length;i++)if(pts[i].K>=k){const a=pts[i-1],b=pts[i];return a.above+(k-a.K)/(b.K-a.K)*(b.above-a.above);}return null;
}

export function eventsForExpiry(events,expiryDate,today=todayNY()) {
  return (events||[]).filter(e=>e.date>=today&&e.date<=expiryDate);
}

export function constantMaturityIv(options,spot,days=30) {
  const good=options.filter(o=>quoteQuality(o).usable&&o.iv>0);
  const dtes=[...new Set(good.map(o=>o.dte))].sort((a,b)=>a-b);
  const at=dte=>{const rows=good.filter(o=>o.dte===dte);const pair=['C','P'].map(type=>rows.filter(o=>o.type===type).sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0]).filter(o=>o&&Math.abs(o.strike/spot-1)<.1);return pair.length?pair.reduce((s,o)=>s+o.iv,0)/pair.length:null;};
  const before=dtes.filter(d=>d<=days).at(-1),after=dtes.find(d=>d>=days);
  if(before==null||after==null)return null;
  const a=at(before),b=at(after);if(a==null||b==null)return null;
  if(before===after)return a;
  const w=(days-before)/(after-before);return Math.sqrt(((1-w)*a*a*before+w*b*b*after)/days);
}
export function realizedHistory(closes,window=21) {
  const rows=[...(closes||[])].filter(p=>p.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  return rows.slice(window).map((p,index)=>{const start=index,returns=rows.slice(start+1,start+window+1).map((r,i)=>Math.log(r.close/rows[start+i].close));const mean=returns.reduce((a,b)=>a+b,0)/returns.length;return {date:p.date,rv:Math.sqrt(252*returns.reduce((s,r)=>s+(r-mean)**2,0)/(returns.length-1))*100};});
}
export function earningsWindows(events,closes) {
  const prices=[...(closes||[])].filter(p=>p.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  return (events||[]).map(e=>{const before=prices.filter(p=>p.date<e.date).at(-1),after=prices.find(p=>p.date>e.date);const valid=before&&after&&daysBetween(before.date,e.date)<=5&&daysBetween(e.date,after.date)<=5;
    return {...e,from:valid?before.date:null,to:valid?after.date:null,move:valid?100*(after.close/before.close-1):null};});
}
