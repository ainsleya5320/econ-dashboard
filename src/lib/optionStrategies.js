// Classic option strategies: candidate builder, conservative pricing, payoff math and plain-English notes.
// Shared by the Options tab (Strategies view) and the server screener, so: pure ESM, no Node or browser APIs.
// Conventions: prices are per share; money is per ONE lot (1 contract per option leg = 100 shares).
// Fills are conservative (sell at bid, buy at ask). Entry fees are included; closing/assignment fees are not.
// Odds come only from a smileDistribution() object for the same expiry: risk-neutral, not forecasts.
import {finite,quoteQuality,distributionAbove} from './optionsAnalysis.js';

const LOT=100;
const INF=Infinity;

export const CAVEATS={
  odds:'Odds are market-implied (risk-neutral) probabilities from today’s option prices, not forecasts.',
  fills:'Sells are priced at the bid and buys at the ask from delayed quotes; actual fills may differ.',
  fees:'Entry commissions are included; closing, exercise and assignment fees, taxes and slippage are not.',
  expiry:'Results assume the position is held to expiry with no early assignment.',
  basis:'Covered-call and collar stock P&L is measured from today’s price, not your cost basis.',
  margin:'Naked-option margin is approximated with the Reg T 20% rule; actual requirements vary by broker and underlying.',
  notAdvice:'These describe how each trade works; they are not recommendations.',
};

const NOTE={
  fills:'Sells at bid, buys at ask; entry fees included, closing fees excluded',
  events:'Earnings or ex-dividend may fall before expiry: check the event strip',
  basis:'Stock P&L measured from today’s price, not your cost basis',
  csp:'Capital is the full strike in cash; interest on it is excluded',
  margin:'Margin approximated (Reg T 20% rule); brokers differ',
  pin:'Maximum profit requires finishing exactly at the center strike',
  noOdds:'Odds withheld: a break-even lies outside the quoted strike range',
  wrongDist:'Odds withheld: the distribution supplied is for a different expiry',
};

export const STRATEGIES=[
  {id:'csp',name:'Cash-secured put',family:'income',outlook:'bullish',volView:'sell volatility',
    legs:'Sell 1 put below the price; hold cash to buy 100 shares at the strike',
    summary:'Collects a premium for agreeing to buy 100 shares at the strike; often used as a paid limit order on a stock one would own.',
    maxProfit:'The premium received, less fees.',
    maxLoss:'The strike minus the premium, times 100, plus fees, if the stock goes to zero.',
    breakeven:'The strike minus the premium per share.',
    capital:'The strike times 100, held in cash until expiry or assignment.',
    bestWhen:['Owning the shares at the strike would be acceptable','The outlook is flat to modestly higher','Implied volatility is rich relative to recent moves'],
    risks:['A steep fall means buying shares well above market, cushioned only by the premium','Upside is capped at the premium','A deep in-the-money put can be assigned before expiry','Earnings or news can gap the stock through the strike'],
    management:['Many traders buy the put back at about half the credit','Some roll down and out in time rather than take assignment','A common convention is to close or roll near 21 days to expiry'],
    defaults:{delta:.25}},
  {id:'coveredCall',name:'Covered call',family:'income',outlook:'bullish',volView:'sell volatility',
    legs:'Own 100 shares; sell 1 call above the price',
    summary:'Earns a premium on shares already owned in exchange for capping the sale price at the strike; suits a flat to modestly rising view.',
    maxProfit:'The strike minus today’s price, plus the premium, times 100, less fees.',
    maxLoss:'Today’s price minus the premium, times 100, plus fees, if the stock goes to zero.',
    breakeven:'Today’s price minus the premium per share.',
    capital:'Today’s price times 100 for the shares.',
    bestWhen:['Selling the shares at the strike would be acceptable','A flat to modestly rising stock is expected','Implied volatility is rich relative to recent moves'],
    risks:['The stock’s downside is kept, reduced only by the premium','Gains above the strike go to the call buyer','An in-the-money call is often assigned early just before an ex-dividend date if its time value is below the dividend','Assignment is a sale and can realize a taxable gain'],
    management:['Many traders buy the call back at about half the credit','Some roll up and out when the stock nears the strike','Some close or roll before an ex-dividend date to avoid early assignment'],
    defaults:{delta:.25}},
  {id:'bullPut',name:'Bull put spread',family:'spread',outlook:'bullish',volView:'sell volatility',
    legs:'Sell 1 put below the price; buy 1 lower put as protection',
    summary:'Collects a credit that is kept if the stock stays above the short strike; the lower put caps the loss.',
    maxProfit:'The net credit, less fees.',
    maxLoss:'The width between strikes minus the credit, times 100, plus fees.',
    breakeven:'The short strike minus the net credit per share.',
    capital:'The width times 100 minus the credit (the maximum loss).',
    bestWhen:['The stock is expected to hold above a support level','A capped loss is wanted instead of a naked put','Implied volatility is rich'],
    risks:['The loss can be several times the credit if the stock falls through both strikes','The short put can be assigned early when deep in the money, leaving 100 shares to fund','Pin risk: a close near the short strike leaves assignment uncertain','An earnings gap can jump straight to the maximum loss'],
    management:['Many traders take profits at about half the credit','Some close when the loss reaches about twice the credit','A common convention is to exit near 21 days to expiry'],
    defaults:{delta:.25,width:.05}},
  {id:'bearCall',name:'Bear call spread',family:'spread',outlook:'bearish',volView:'sell volatility',
    legs:'Sell 1 call above the price; buy 1 higher call as protection',
    summary:'Collects a credit that is kept if the stock stays below the short strike; the higher call caps the loss.',
    maxProfit:'The net credit, less fees.',
    maxLoss:'The width between strikes minus the credit, times 100, plus fees.',
    breakeven:'The short strike plus the net credit per share.',
    capital:'The width times 100 minus the credit (the maximum loss).',
    bestWhen:['The stock is expected to stay below a resistance level','A capped loss is wanted instead of a naked call','Implied volatility is rich'],
    risks:['A rally through both strikes produces the maximum loss','An in-the-money short call is often assigned early before an ex-dividend date if its time value is below the dividend','Pin risk: a close near the short strike leaves assignment uncertain','Earnings or takeover news can gap the stock higher'],
    management:['Many traders take profits at about half the credit','Some close when the loss reaches about twice the credit','A common convention is to exit near 21 days to expiry'],
    defaults:{delta:.25,width:.05}},
  {id:'bullCall',name:'Bull call spread',family:'spread',outlook:'bullish',volView:'mixed',
    legs:'Buy 1 call near the price; sell 1 higher call',
    summary:'Pays a debit for a capped bet on a rise; selling the higher call lowers the cost of the bought call.',
    maxProfit:'The width between strikes minus the debit, times 100, less fees.',
    maxLoss:'The debit paid plus fees.',
    breakeven:'The lower strike plus the debit per share.',
    capital:'The debit paid plus fees.',
    bestWhen:['A moderate rise toward the upper strike is expected','A defined cost is preferred to buying shares','A single call alone looks expensive'],
    risks:['The whole debit is lost if the stock ends below the lower strike','Gains are capped at the upper strike','The short call can be assigned early before an ex-dividend date','Time decay works against the position while it is below break-even'],
    management:['Many traders take profits at 50–75% of the maximum gain','Some cut the trade after losing about half the debit','A common convention is to close before expiry rather than exercise'],
    defaults:{delta:.30,width:.05}},
  {id:'bearPut',name:'Bear put spread',family:'spread',outlook:'bearish',volView:'mixed',
    legs:'Buy 1 put near the price; sell 1 lower put',
    summary:'Pays a debit for a capped bet on a decline; selling the lower put lowers the cost of the bought put.',
    maxProfit:'The width between strikes minus the debit, times 100, less fees.',
    maxLoss:'The debit paid plus fees.',
    breakeven:'The upper strike minus the debit per share.',
    capital:'The debit paid plus fees.',
    bestWhen:['A moderate decline toward the lower strike is expected','Defined-cost downside exposure or a hedge is wanted','A single put alone looks expensive'],
    risks:['The whole debit is lost if the stock ends above the upper strike','Gains stop below the lower strike','The short put can be assigned early when deep in the money','Time decay works against the position while it is above break-even'],
    management:['Many traders take profits at 50–75% of the maximum gain','Some cut the trade after losing about half the debit','A common convention is to close before expiry rather than exercise'],
    defaults:{delta:.30,width:.05}},
  {id:'shortStrangle',name:'Short strangle',family:'volatility',outlook:'neutral',volView:'sell volatility',
    legs:'Sell 1 put below and 1 call above the price',
    summary:'Collects two premiums that are kept if the stock stays between the strikes; losses are open-ended on a large move.',
    maxProfit:'Both premiums received, less fees.',
    maxLoss:'Unlimited on the upside; on the downside, the put strike minus the credit, times 100.',
    breakeven:'The put strike minus the credit, and the call strike plus the credit.',
    capital:'Naked-option margin, approximated here with the Reg T 20% rule.',
    bestWhen:['A range-bound stock is expected through expiry','Implied volatility is high and expected to fall','The account is approved and sized for naked options'],
    risks:['The loss is unlimited if the stock rallies hard, and large if it collapses','Margin requirements rise as the stock moves against the position','Either short can be assigned early; the call especially before an ex-dividend date','Earnings or news gaps can blow through either strike overnight'],
    management:['Many traders take profits at about half the credit','Some exit when the loss reaches about twice the credit','A common convention is to close or roll near 21 days to expiry'],
    defaults:{delta:.16}},
  {id:'ironCondor',name:'Iron condor',family:'volatility',outlook:'neutral',volView:'sell volatility',
    legs:'Sell a put spread below and a call spread above the price',
    summary:'A short strangle with protective wings: the credit is kept if the stock stays between the short strikes, and the loss is capped.',
    maxProfit:'The net credit, less fees.',
    maxLoss:'The wider spread’s width minus the credit, times 100, plus fees.',
    breakeven:'The short put strike minus the credit, and the short call strike plus the credit.',
    capital:'The wider width times 100 minus the credit (the maximum loss).',
    bestWhen:['A range-bound stock is expected','Implied volatility is high and expected to fall','A defined, capped loss is required'],
    risks:['The maximum loss is usually several times the credit','Four legs mean four commissions and four bid–ask spreads','A short leg can be assigned early; the call especially before an ex-dividend date','Pin risk if the stock closes near a short strike at expiry'],
    management:['Many traders take profits at about half the credit','Some close the tested side when a short strike is reached','A common convention is to exit near 21 days to expiry'],
    defaults:{delta:.16,width:.05}},
  {id:'ironButterfly',name:'Iron butterfly',family:'volatility',outlook:'neutral',volView:'sell volatility',
    legs:'Sell 1 put and 1 call at the price; buy 1 lower put and 1 higher call',
    summary:'Sells the at-the-money straddle with protective wings for a large credit; profit peaks if the stock finishes at the center strike.',
    maxProfit:'The net credit, less fees, only if the stock ends exactly at the center strike.',
    maxLoss:'The wider wing’s width minus the credit, times 100, plus fees.',
    breakeven:'The center strike minus the credit, and the center strike plus the credit.',
    capital:'The wider wing width times 100 minus the credit (the maximum loss).',
    bestWhen:['The stock is expected to stay near today’s price','Implied volatility is high and expected to fall','A defined, capped loss is required'],
    risks:['The profitable range is narrow; most outcomes keep only part of the credit','One short leg is in the money once the stock moves, so early assignment is possible, the call especially before an ex-dividend date','Pin risk at the center strike at expiry','An earnings gap can reach the maximum loss'],
    management:['Many traders take profits at 25–50% of the credit','Some close if the stock reaches a break-even','Many traders close before expiry rather than face pin risk'],
    defaults:{delta:.5,width:.05}},
  {id:'longStraddle',name:'Long straddle',family:'volatility',outlook:'big move',volView:'buy volatility',
    legs:'Buy 1 put and 1 call at the same strike near the price',
    summary:'Pays two premiums for a position that gains from a large move in either direction; time decay and falling volatility work against it.',
    maxProfit:'Unlimited on the upside; on the downside, the strike minus the debit, times 100.',
    maxLoss:'The debit paid plus fees, if the stock ends exactly at the strike.',
    breakeven:'The strike minus the debit, and the strike plus the debit.',
    capital:'The debit paid plus fees.',
    bestWhen:['A large move is expected but the direction is unclear','Implied volatility is low relative to the likely move','A known catalyst falls before expiry'],
    risks:['The stock must move more than the debit just to break even','Implied volatility often drops after earnings, cutting both legs’ value','Time decay speeds up near expiry','Both options can lose most of their value if the stock stays near the strike'],
    management:['Many traders exit soon after the catalyst instead of holding to expiry','Some set a loss limit at about half the debit','A common convention is to close with a few weeks left to limit decay'],
    defaults:{delta:.5}},
  {id:'longStrangle',name:'Long strangle',family:'volatility',outlook:'big move',volView:'buy volatility',
    legs:'Buy 1 put below and 1 call above the price',
    summary:'A cheaper relative of the straddle using out-of-the-money options; it needs a larger move to pay off.',
    maxProfit:'Unlimited on the upside; on the downside, the put strike minus the debit, times 100.',
    maxLoss:'The debit paid plus fees, if the stock ends between the strikes.',
    breakeven:'The put strike minus the debit, and the call strike plus the debit.',
    capital:'The debit paid plus fees.',
    bestWhen:['A large move is expected but the direction is unclear','Implied volatility is low relative to the likely move','A known catalyst falls before expiry'],
    risks:['The stock must move past a strike by more than the debit','Implied volatility often falls after the event, cutting both legs’ value','Time decay is steady and speeds up near expiry','Both options expire worthless if the stock stays between the strikes'],
    management:['Many traders exit soon after the catalyst instead of holding to expiry','Some set a loss limit at about half the debit','A common convention is to close with a few weeks left to limit decay'],
    defaults:{delta:.25}},
  {id:'collar',name:'Collar',family:'hedge',outlook:'protect',volView:'mixed',
    legs:'Own 100 shares; buy 1 put below and sell 1 call above the price',
    summary:'Puts a floor under shares already owned, paid for partly or fully by selling a call that caps the upside.',
    maxProfit:'The call strike minus today’s price, plus the net premium, times 100, less fees.',
    maxLoss:'Today’s price minus the put strike, minus the net premium, times 100, plus fees.',
    breakeven:'Today’s price minus the net premium (call received less put paid) per share.',
    capital:'The shares at today’s price plus the put cost, less the call premium.',
    bestWhen:['Protecting gains in a concentrated or low-basis position','Downside protection is wanted at little or no net cost','Giving up gains above the call strike is acceptable'],
    risks:['Gains above the call strike are given up','The short call can be assigned early before an ex-dividend date, selling the shares','The put protects only until its expiry','Tight collars on appreciated stock can raise holding-period and constructive-sale tax questions'],
    management:['Many advisors roll the collar out before expiry to keep the hedge in place','Some pick strikes so the call premium pays for the put (a zero-cost collar)','A common convention is to roll the call up if the stock approaches it'],
    defaults:{delta:.25,wingDelta:.25}},
];
export const STRATEGY_BY_ID=Object.fromEntries(STRATEGIES.map(s=>[s.id,s]));
const ALL_IDS=STRATEGIES.map(s=>s.id);
// Expected sign of the net premium: credit trades must collect, debit trades must pay; a collar can be either.
const NET_SIGN={csp:1,coveredCall:1,bullPut:1,bearCall:1,shortStrangle:1,ironCondor:1,ironButterfly:1,bullCall:-1,bearPut:-1,longStraddle:-1,longStrangle:-1,collar:0};
const HAS_SHARES=new Set(['coveredCall','collar']);

// ---- payoff -------------------------------------------------------------------------------------
const sign=side=>side==='buy'?1:-1;
const intrinsic=(type,strike,price)=>type==='C'?Math.max(price-strike,0):Math.max(strike-price,0);
// Per-share P&L before fees: option values at expiry, plus the net premium, plus any stock measured from `spot`.
function perShare(legs,shares,spot,net,price) {
  let v=net+(shares/LOT)*(price-spot);
  for(const l of legs)v+=sign(l.side)*(l.qty??1)*intrinsic(l.type,l.strike,price);
  return v;
}
export function payoff(candidate,priceAtExpiry) {
  if(!candidate||!finite(priceAtExpiry))return null;
  return LOT*perShare(candidate.legs,candidate.shares||0,candidate.spot,candidate.netPerShare,Math.max(0,priceAtExpiry))-(candidate.fees||0);
}
// Convenience for charts: P&L at evenly spaced prices plus every strike and break-even (sorted).
export function payoffCurve(candidate,{from=0,to=null,n=80}={}) {
  if(!candidate)return [];
  const hi=finite(to)?to:2*candidate.spot,xs=new Set([...Array.from({length:n+1},(_,i)=>from+(hi-from)*i/n),...candidate.legs.map(l=>l.strike),...candidate.breakevens,candidate.spot]);
  return [...xs].filter(x=>x>=from&&x<=hi).sort((a,b)=>a-b).map(price=>({price,pnl:payoff(candidate,price)}));
}

// Generic payoff shapes for small diagrams: x is price relative to spot (-1..1), y is scaled to -1..1.
const SHAPES={
  csp:{net:.1,legs:[['P','sell',-.25]]},
  coveredCall:{net:.1,shares:LOT,legs:[['C','sell',.25]]},
  bullPut:{net:.1,legs:[['P','sell',-.2],['P','buy',-.5]]},
  bearCall:{net:.1,legs:[['C','sell',.2],['C','buy',.5]]},
  bullCall:{net:-.15,legs:[['C','buy',0],['C','sell',.35]]},
  bearPut:{net:-.15,legs:[['P','buy',0],['P','sell',-.35]]},
  shortStrangle:{net:.15,legs:[['P','sell',-.3],['C','sell',.3]]},
  ironCondor:{net:.12,legs:[['P','buy',-.6],['P','sell',-.25],['C','sell',.25],['C','buy',.6]]},
  ironButterfly:{net:.25,legs:[['P','buy',-.45],['P','sell',0],['C','sell',0],['C','buy',.45]]},
  longStraddle:{net:-.3,legs:[['P','buy',0],['C','buy',0]]},
  longStrangle:{net:-.12,legs:[['P','buy',-.25],['C','buy',.25]]},
  collar:{net:0,shares:LOT,legs:[['P','buy',-.2],['C','sell',.25]]},
};
export function schematic(id) {
  const s=SHAPES[id];if(!s)return [];
  const legs=s.legs.map(([type,side,strike])=>({type,side,strike,qty:1}));
  const xs=[...new Set([-1,...legs.map(l=>l.strike),1])].sort((a,b)=>a-b);
  const pts=xs.map(x=>({x,y:perShare(legs,s.shares||0,0,s.net,x)}));
  const scale=Math.max(...pts.map(p=>Math.abs(p.y)))||1;
  return pts.map(p=>({x:p.x,y:Math.round(p.y/scale*1e4)/1e4}));
}

// ---- settings, pools and expiry choice ----------------------------------------------------------
const pos=(v,max=INF)=>finite(v)&&v>0&&v<max;
function resolve(id,settings={},spot) {
  const def=STRATEGY_BY_ID[id].defaults,own=settings?.[id]&&typeof settings[id]==='object'?settings[id]:{},s={...settings,...own};
  const width=pos(s.width)?s.width:def.width??.05;
  return {delta:pos(s.delta,1)?s.delta:def.delta,width:width<1?width*spot:width,wingDelta:pos(s.wingDelta,1)?s.wingDelta:def.wingDelta??null,
    maxDeltaMiss:pos(s.maxDeltaMiss,1)?s.maxDeltaMiss:.15,maxSpread:pos(s.maxSpread)?s.maxSpread:.35,minOi:finite(s.minOi)&&s.minOi>=0?s.minOi:50,fee:finite(s.fee)&&s.fee>=0?s.fee:.65};
}
const pools=new WeakMap();
// Usable quotes for one expiry, one entry per strike and type (best spread wins), sorted by strike.
function poolFor(chain,expiryDate,{maxSpread,minOi}) {
  const opts=chain?.options;if(!Array.isArray(opts))return {puts:[],calls:[],dte:null};
  let cache=pools.get(opts);if(!cache){cache=new Map();pools.set(opts,cache);}
  const key=`${expiryDate}|${maxSpread}|${minOi}`;if(cache.has(key))return cache.get(key);
  const best={P:new Map(),C:new Map()};let dte=null;
  for(const o of opts){
    if(o.expiryDate!==expiryDate||o.standard===false||!(o.strike>0)||(o.type!=='P'&&o.type!=='C'))continue;
    const q=quoteQuality(o,{maxSpread,minOi});if(!q.usable)continue;
    dte??=o.dte;const old=best[o.type].get(o.strike);
    if(!old||q.spread<old.spread)best[o.type].set(o.strike,{o,mid:q.mid,spread:q.spread});
  }
  const sorted=m=>[...m.values()].sort((a,b)=>a.o.strike-b.o.strike);
  const pool={puts:sorted(best.P),calls:sorted(best.C),dte};cache.set(key,pool);return pool;
}
// Expiry closest to `dte` among expiries with at least 2 usable out-of-the-money puts and 2 calls (enough for
// a spread on each side), preferring 21-60 days (the window widens to include the requested dte). Ties go to
// the expiry with more usable strikes. Names with $2.50 or $5 strikes often have only 2-3 usable OTM strikes.
export function pickExpiry(chain,{dte=45,settings={}}={}) {
  settings=settings||{};const spot=chain?.spot;if(!pos(spot)||!Array.isArray(chain?.options))return null;
  const maxSpread=pos(settings.maxSpread)?settings.maxSpread:.35,minOi=finite(settings.minOi)&&settings.minOi>=0?settings.minOi:50;
  const stats=new Map();
  for(const o of chain.options){
    if(!(o.dte>0)||o.standard===false||!finite(o.delta))continue;
    const otm=o.type==='P'?o.strike<spot&&o.delta<0:o.type==='C'&&o.strike>spot&&o.delta>0;if(!otm)continue;
    if(!quoteQuality(o,{maxSpread,minOi}).usable)continue;
    const s=stats.get(o.expiryDate)||{expiryDate:o.expiryDate,dte:o.dte,P:0,C:0};s[o.type]++;stats.set(o.expiryDate,s);
  }
  const ok=[...stats.values()].filter(s=>s.P>=2&&s.C>=2);if(!ok.length)return null;
  const target=finite(dte)&&dte>0?dte:45,lo=Math.min(21,target),hi=Math.max(60,target);
  const inWindow=ok.filter(s=>s.dte>=lo&&s.dte<=hi),list=inWindow.length?inWindow:ok;
  const best=list.reduce((a,b)=>{const da=Math.abs(a.dte-target),db=Math.abs(b.dte-target);return db<da||db===da&&b.P+b.C>a.P+a.C?b:a;});
  return {expiryDate:best.expiryDate,dte:best.dte};
}

// ---- candidate assembly -------------------------------------------------------------------------
const absDelta=q=>Math.abs(q.o.delta);
const otmPuts=(pool,spot)=>pool.puts.filter(q=>q.o.strike<spot&&finite(q.o.delta)&&q.o.delta<0);
const otmCalls=(pool,spot)=>pool.calls.filter(q=>q.o.strike>spot&&finite(q.o.delta)&&q.o.delta>0);
const nearDelta=(list,target,n)=>list.map(q=>({q,miss:Math.abs(absDelta(q)-target)})).sort((a,b)=>a.miss-b.miss||a.q.spread-b.q.spread).slice(0,n);
// Protective/companion leg strictly beyond `strike` (dir -1 below, +1 above): by wing delta when given, else nearest to the dollar width.
function wings(list,strike,dir,{width,wingDelta},n) {
  const beyond=list.filter(q=>dir<0?q.o.strike<strike:q.o.strike>strike);
  if(wingDelta!=null)return beyond.filter(q=>finite(q.o.delta)).map(q=>({q,miss:Math.abs(absDelta(q)-wingDelta)})).sort((a,b)=>a.miss-b.miss||a.q.spread-b.q.spread).slice(0,n).map(x=>x.q);
  return beyond.map(q=>({q,miss:Math.abs(Math.abs(q.o.strike-strike)-width)})).sort((a,b)=>a.miss-b.miss||a.q.spread-b.q.spread).slice(0,n).map(x=>x.q);
}
const num=v=>finite(v)?v:null;
function makeLeg(q,side) {
  const o=q.o;
  return {sym:o.sym,type:o.type,side,strike:o.strike,qty:1,bid:o.bid,ask:o.ask,mid:q.mid,fill:side==='sell'?o.bid:o.ask,
    delta:num(o.delta),iv:num(o.iv),oi:num(o.oi),vol:num(o.vol),theta:num(o.theta),vega:num(o.vega),spread:q.spread};
}
const cents=v=>finite(v)?Math.round(v*100)/100:null;
const fmtK=k=>String(Math.round(k*100)/100);

// Closed-form per-share results. `c` is the net premium per share after entry fees (credit > 0).
function closedForm(id,r,c,spot) {
  const K=x=>r[x].strike;
  switch(id){
    case 'csp':return {mp:c,ml:K('sp')-c,be:[K('sp')-c],cap:K('sp'),zone:[K('sp'),INF]};
    case 'coveredCall':return {mp:K('sc')-spot+c,ml:spot-c,be:[spot-c],cap:spot,zone:[K('sc'),INF]};
    case 'bullPut':{const w=K('sp')-K('lp');return {mp:c,ml:w-c,be:[K('sp')-c],width:w,zone:[K('sp'),INF]};}
    case 'bearCall':{const w=K('lc')-K('sc');return {mp:c,ml:w-c,be:[K('sc')+c],width:w,zone:[0,K('sc')]};}
    case 'bullCall':{const w=K('sc')-K('lc');return {mp:w+c,ml:-c,be:[K('lc')-c],width:w,zone:[K('sc'),INF]};}
    case 'bearPut':{const w=K('lp')-K('sp');return {mp:w+c,ml:-c,be:[K('lp')+c],width:w,zone:[0,K('sp')]};}
    case 'shortStrangle':return {mp:c,ml:null,unlimitedLoss:true,be:[K('sp')-c,K('sc')+c],zone:[K('sp'),K('sc')]};
    case 'ironCondor':{const wp=K('sp')-K('lp'),wc=K('lc')-K('sc');return {mp:c,ml:Math.max(wp,wc)-c,minW:Math.min(wp,wc),be:[K('sp')-c,K('sc')+c],width:Math.max(wp,wc),zone:[K('sp'),K('sc')]};}
    case 'ironButterfly':{const wp=K('sp')-K('lp'),wc=K('lc')-K('sc');return {mp:c,ml:Math.max(wp,wc)-c,minW:Math.min(wp,wc),be:[K('sp')-c,K('sc')+c],width:Math.max(wp,wc),zone:null};}
    case 'longStraddle':return {mp:null,unlimitedProfit:true,ml:-c,be:[K('lp')+c,K('lc')-c].filter(x=>x>0),zone:null};
    case 'longStrangle':return {mp:null,unlimitedProfit:true,ml:-c,be:[K('lp')+c,K('lc')-c].filter(x=>x>0),zone:null};
    case 'collar':return {mp:K('sc')-spot+c,ml:spot-K('lp')-c,be:[spot-c],cap:spot-c,zone:[K('sc'),INF]};
  }
  return null;
}
// Approximate Reg T initial margin for a short strangle, per share: the larger side's requirement
// (premium + max(20% of the stock less the out-of-the-money amount, 10% of stock or strike)) plus the other side's premium.
function strangleMargin(r,spot) {
  const p=r.sp,cl=r.sc;
  const reqP=p.fill+Math.max(.2*spot-Math.max(spot-p.strike,0),.1*p.strike);
  const reqC=cl.fill+Math.max(.2*spot-Math.max(cl.strike-spot,0),.1*spot);
  return reqP>=reqC?reqP+cl.fill:reqC+p.fill;
}
const above=(dist,k)=>k<=0?1:k===INF?0:distributionAbove(dist,k);
function probProfit(cand,dist) {
  const bes=[...cand.breakevens].sort((a,b)=>a-b),edges=[0,...bes,INF];let p=0;
  for(let i=0;i<edges.length-1;i++){
    const lo=edges[i],hi=edges[i+1],test=hi===INF?(lo>0?lo*1.1+.01:cand.spot):(lo+hi)/2;
    if(!(payoff(cand,test)>0))continue;
    const a=above(dist,lo),b=above(dist,hi);if(a==null||b==null)return null;p+=a-b;
  }
  return Math.max(0,Math.min(1,p));
}

function assemble(id,roles,{spot,dte,expiryDate,s,dist,distNote,deltaMiss,targetWidth}) {
  const legs=Object.values(roles).map(x=>x.leg).sort((a,b)=>a.strike-b.strike||(a.type==='P'?-1:1));
  const r=Object.fromEntries(Object.entries(roles).map(([k,x])=>[k,x.leg]));
  const shares=HAS_SHARES.has(id)?LOT:0;
  const tidy=v=>Math.round(v*1e6)/1e6; // quotes are in cents; strip float noise
  const net=tidy(legs.reduce((t,l)=>t-sign(l.side)*l.qty*l.fill,0)),netMid=tidy(legs.reduce((t,l)=>t-sign(l.side)*l.qty*l.mid,0));
  const fees=s.fee*legs.reduce((t,l)=>t+l.qty,0),c=net-fees/LOT;
  const f=closedForm(id,r,c,spot);if(!f)return null;
  // Reject trades whose quotes leave no profit, no risk, or a credit at least as large as a wing.
  if(NET_SIGN[id]>0&&!(net>0)||NET_SIGN[id]<0&&!(net<0))return null;
  if(f.mp!=null&&!(f.mp>0))return null;
  if(f.ml!=null&&!(f.ml>0))return null;
  if(f.minW!=null&&!(c<f.minW))return null;
  if(!f.be.length)return null;
  const maxProfit=f.mp==null?null:cents(LOT*f.mp),maxLoss=f.ml==null?null:cents(LOT*f.ml);
  const capital=cents(id==='shortStrangle'?LOT*strangleMargin(r,spot):f.cap!=null?LOT*f.cap:LOT*f.ml);
  const returnOnRisk=maxProfit==null?null:id==='csp'||id==='coveredCall'?maxProfit/capital:maxLoss>0?maxProfit/maxLoss:null;
  const greek=k=>{let t=0;for(const l of legs){if(!finite(l[k]))return null;t+=sign(l.side)*l.qty*l[k];}return LOT*t+(k==='delta'?shares:0);};
  const width=finite(f.width)?f.width:null;
  const notes=[NOTE.fills,NOTE.events];
  if(shares)notes.push(NOTE.basis);
  if(id==='csp')notes.push(NOTE.csp);
  if(id==='shortStrangle')notes.push(NOTE.margin);
  if(id==='ironButterfly')notes.push(NOTE.pin);
  if(width!=null&&targetWidth>0&&Math.abs(width-targetWidth)/targetWidth>.25)notes.push(`Nearest listed width is $${fmtK(width)} (target about $${fmtK(targetWidth)})`);
  const cand={strategy:id,key:`${id}:${legs.map(l=>l.sym).join('+')}`,
    label:[shares?'Own 100 shares':null,...legs.map(l=>`${l.side==='sell'?'Sell':'Buy'} ${fmtK(l.strike)} ${l.type==='P'?'put':'call'}`)].filter(Boolean).join(' · '),
    expiryDate,dte,spot,legs,shares,netPerShare:net,netMidPerShare:netMid,fees,
    maxProfit,maxLoss,unlimitedProfit:!!f.unlimitedProfit,unlimitedLoss:!!f.unlimitedLoss,
    breakevens:f.be.map(b=>Math.round(b*1e4)/1e4).sort((a,b)=>a-b),capital,
    returnOnRisk,annualized:returnOnRisk==null||!(dte>0)?null:returnOnRisk*365/dte,
    returnOnCapital:maxProfit!=null&&capital>0?maxProfit/capital:null,
    pop:null,pMax:null,
    greeks:{delta:greek('delta'),theta:greek('theta'),vega:greek('vega')},
    liquidity:{worstSpread:Math.max(...legs.map(l=>l.spread)),minOi:Math.min(...legs.map(l=>l.oi??0))},
    width,targetWidth:width!=null?targetWidth:null,deltaMiss,notes};
  if(dist){
    cand.pop=probProfit(cand,dist);
    if(f.zone&&!f.unlimitedProfit){const a=above(dist,f.zone[0]),b=above(dist,f.zone[1]);cand.pMax=a==null||b==null?null:Math.max(0,Math.min(1,a-b));}
    if(cand.pop==null)notes.push(NOTE.noOdds);
  }else if(distNote)notes.push(distNote);
  return cand;
}

// ---- per-strategy leg selection -----------------------------------------------------------------
const L=(q,side)=>({leg:makeLeg(q,side),q});
function selectLegs(id,pool,spot,s) {
  const P=otmPuts(pool,spot),C=otmCalls(pool,spot),combos=[];
  const debit={...s,wingDelta:null}; // a debit spread's bought leg is set by width only
  switch(id){
    case 'csp':for(const {q,miss} of nearDelta(P,s.delta,8))combos.push({roles:{sp:L(q,'sell')},miss});break;
    case 'coveredCall':for(const {q,miss} of nearDelta(C,s.delta,8))combos.push({roles:{sc:L(q,'sell')},miss});break;
    case 'bullPut':for(const {q,miss} of nearDelta(P,s.delta,4))for(const w of wings(pool.puts,q.o.strike,-1,s,2))combos.push({roles:{sp:L(q,'sell'),lp:L(w,'buy')},miss});break;
    case 'bearCall':for(const {q,miss} of nearDelta(C,s.delta,4))for(const w of wings(pool.calls,q.o.strike,1,s,2))combos.push({roles:{sc:L(q,'sell'),lc:L(w,'buy')},miss});break;
    case 'bullCall':for(const {q,miss} of nearDelta(C,s.delta,4))for(const w of wings(pool.calls,q.o.strike,-1,debit,2))combos.push({roles:{lc:L(w,'buy'),sc:L(q,'sell')},miss});break;
    case 'bearPut':for(const {q,miss} of nearDelta(P,s.delta,4))for(const w of wings(pool.puts,q.o.strike,1,debit,2))combos.push({roles:{lp:L(w,'buy'),sp:L(q,'sell')},miss});break;
    case 'shortStrangle':case 'longStrangle':{
      const side=id==='shortStrangle'?'sell':'buy',key=side==='sell'?['sp','sc']:['lp','lc'];
      for(const p of nearDelta(P,s.delta,3))for(const c of nearDelta(C,s.delta,3))combos.push({roles:{[key[0]]:L(p.q,side),[key[1]]:L(c.q,side)},miss:(p.miss+c.miss)/2,worst:Math.max(p.miss,c.miss)});
      break;}
    case 'ironCondor':
      for(const p of nearDelta(P,s.delta,3))for(const c of nearDelta(C,s.delta,3)){
        const lp=wings(pool.puts,p.q.o.strike,-1,s,1)[0],lc=wings(pool.calls,c.q.o.strike,1,s,1)[0];
        if(lp&&lc)combos.push({roles:{lp:L(lp,'buy'),sp:L(p.q,'sell'),sc:L(c.q,'sell'),lc:L(lc,'buy')},miss:(p.miss+c.miss)/2,worst:Math.max(p.miss,c.miss)});
      }
      break;
    case 'ironButterfly':case 'longStraddle':{
      const puts=new Map(pool.puts.map(q=>[q.o.strike,q]));
      const centers=pool.calls.filter(q=>puts.has(q.o.strike)&&finite(q.o.delta)&&finite(puts.get(q.o.strike).o.delta))
        .map(q=>{const p=puts.get(q.o.strike),mc=Math.abs(q.o.delta-s.delta),mp=Math.abs(Math.abs(p.o.delta)-(1-s.delta));return {c:q,p,miss:(mc+mp)/2,worst:Math.max(mc,mp)};})
        .sort((a,b)=>a.miss-b.miss||Math.max(a.c.spread,a.p.spread)-Math.max(b.c.spread,b.p.spread)).slice(0,id==='longStraddle'?8:4);
      for(const {c,p,miss,worst} of centers){
        if(id==='longStraddle'){combos.push({roles:{lp:L(p,'buy'),lc:L(c,'buy')},miss,worst});continue;}
        // Prefer wing pairs near the target that are also symmetric (equal widths, or equal deltas when set by wingDelta).
        const K=c.o.strike,pairs=[];
        for(const a of wings(pool.puts,K,-1,s,3))for(const b of wings(pool.calls,K,1,s,3)){
          const wp=K-a.o.strike,wc=b.o.strike-K;
          const score=s.wingDelta!=null?Math.abs(absDelta(a)-s.wingDelta)+Math.abs(absDelta(b)-s.wingDelta)+Math.abs(absDelta(a)-absDelta(b))
            :(Math.abs(wp-s.width)+Math.abs(wc-s.width)+Math.abs(wp-wc))/s.width;
          pairs.push({a,b,score});
        }
        pairs.sort((x,y)=>x.score-y.score).slice(0,2).forEach(({a,b})=>combos.push({roles:{lp:L(a,'buy'),sp:L(p,'sell'),sc:L(c,'sell'),lc:L(b,'buy')},miss,worst}));
      }
      break;}
    case 'collar':{
      const putTarget=s.wingDelta??s.delta;
      for(const c of nearDelta(C,s.delta,3))for(const p of nearDelta(P,putTarget,3))combos.push({roles:{lp:L(p.q,'buy'),sc:L(c.q,'sell')},miss:(p.miss+c.miss)/2,worst:Math.max(p.miss,c.miss)});
      break;}
  }
  return combos;
}

/**
 * Candidates for one strategy at one expiry, best first (closest to the target delta, then the
 * requested width, then the tightest bid–ask spread). At most 8. Never throws for missing data.
 * dist: smileDistribution() output for THIS expiry, or (expiryDate, dte) => dist. Mismatched expiries are ignored.
 * settings: { delta, width ($, or fraction of spot if < 1), wingDelta, maxSpread=.35, minOi=50, fee=.65,
 *   maxDeltaMiss=.15 (drop combos whose targeted leg is further than this from the target |delta|) }.
 */
export function buildCandidates(chain,{strategy,expiryDate=null,dist=null,settings={}}={}) {
  if(!STRATEGY_BY_ID[strategy])throw new Error(`Unknown option strategy: ${strategy}`);
  const spot=chain?.spot;if(!pos(spot)||!Array.isArray(chain?.options))return [];
  const s=resolve(strategy,settings||{},spot);
  const expiry=expiryDate||pickExpiry(chain,{dte:settings?.dte??45,settings:s})?.expiryDate;if(!expiry)return [];
  const pool=poolFor(chain,expiry,s);if(!pool.dte)return [];
  let d=typeof dist==='function'?dist(expiry,pool.dte):dist,distNote=null;
  if(d&&(!Array.isArray(d.pts)||!d.pts.length||finite(d.dte)&&d.dte!==pool.dte||d.expiryDate&&d.expiryDate!==expiry)){d=null;distNote=NOTE.wrongDist;}
  // Wings are set by dollar width for vertical spreads and, unless wingDelta is given, condors and butterflies.
  const byWidth=strategy==='bullCall'||strategy==='bearPut'||['bullPut','bearCall','ironCondor','ironButterfly'].includes(strategy)&&s.wingDelta==null;
  const out=[];
  for(const {roles,miss,worst=miss} of selectLegs(strategy,pool,spot,s)){
    if(worst>s.maxDeltaMiss)continue; // e.g. a "0.25-delta" spread whose only usable short is at 0.47 delta is not offered
    const c=assemble(strategy,roles,{spot,dte:pool.dte,expiryDate:expiry,s,dist:d,distNote,deltaMiss:miss,targetWidth:byWidth?s.width:null});
    if(c)out.push(c);
  }
  const widthMiss=c=>c.width!=null&&c.targetWidth>0?Math.round(Math.abs(c.width-c.targetWidth)/c.targetWidth*10):0;
  out.sort((a,b)=>Math.round(a.deltaMiss*100)-Math.round(b.deltaMiss*100)||widthMiss(a)-widthMiss(b)||a.liquidity.worstSpread-b.liquidity.worstSpread||b.liquidity.minOi-a.liquidity.minOi);
  const seen=new Set();
  return out.filter(c=>!seen.has(c.key)&&seen.add(c.key)).slice(0,8);
}

/**
 * One pick per strategy at the expiry closest to `dte` (preferring 21-60 days), using each
 * strategy's default delta/width. settings may hold shared maxSpread/minOi/fee/maxDeltaMiss and per-strategy
 * overrides as settings[id] = {delta,width,wingDelta}. dist: object for the chosen expiry or a function
 * (expiryDate, dte) => smileDistribution(...). Use pickExpiry() first to know which expiry to model.
 */
export function screenChain(chain,{dist=null,dte=45,strategies=ALL_IDS,settings={}}={}) {
  const ids=(strategies||ALL_IDS).filter(Boolean),picks=Object.fromEntries(ids.map(id=>[id,null]));
  const common={};for(const k of ['maxSpread','minOi','fee','maxDeltaMiss'])if(settings?.[k]!=null)common[k]=settings[k];
  const pick=pickExpiry(chain,{dte,settings:common});
  if(!pick)return {expiryDate:null,dte:null,spot:chain?.spot??null,oddsAvailable:false,picks};
  const d=typeof dist==='function'?dist(pick.expiryDate,pick.dte):dist;
  for(const id of ids){
    if(!STRATEGY_BY_ID[id])continue;
    const own=settings?.[id]&&typeof settings[id]==='object'?settings[id]:{};
    picks[id]=buildCandidates(chain,{strategy:id,expiryDate:pick.expiryDate,dist:d,settings:{...common,...own}})[0]??null;
  }
  const oddsAvailable=Object.values(picks).some(c=>c&&c.pop!=null);
  return {expiryDate:pick.expiryDate,dte:pick.dte,spot:chain.spot,oddsAvailable,picks};
}
