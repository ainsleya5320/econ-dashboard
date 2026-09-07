import React,{useMemo,useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceLine,Legend} from 'recharts';
import {finite,number,chooseCandidates,payoffCase,americanPrice,eventsForExpiry} from '../../lib/optionsAnalysis.js';

export const money=v=>finite(v)?v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}):'—';
const pct=v=>finite(v)?`${v.toFixed(1)}%`:'—';
const chartTip={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)',borderRadius:5};
export function modelInputs(context,spot,dte=90) {
  const tenors=[['month1',30],['month2',60],['month3',90],['month6',180],['year1',365]];
  const available=tenors.filter(([key])=>finite(context?.rates?.[key]));
  const match=available.sort((a,b)=>Math.abs(a[1]-dte)-Math.abs(b[1]-dte))[0];
  const dividend=context?.status?.dividends==='available'&&spot>0?(context.dividends||[]).reduce((s,d)=>s+(d.adjustedAmount??d.amount??0),0)/spot:null;
  return {rate:match?context.rates[match[0]]/100:null,dividend,rateDate:context?.rates?.date??null};
}

function Field({label,value,onChange,...rest}) {return <label className="opt-field">{label}<input type="number" value={value??''} onChange={e=>onChange(e.target.value)} {...rest}/></label>;}
function ThesisFields({thesis,onChange}) {
  return <section className="opt-card"><div className="opt-section-label">Your investment thesis · saved on this device</div><h2>Set the prices that work for you</h2><p className="opt-note">Enter your own estimates. Blank valuations remain unknown; no target price is generated for you.</p><div className="opt-input-grid">
    {[['buyBelow','Maximum effective purchase price'],['sellAbove','Minimum sale strike'],['bear','Bear-case price at expiry'],['base','Base-case price at expiry'],['bull','Bull-case price at expiry']].map(([key,label])=><Field key={key} label={`${label} ($)`} value={thesis[key]} min="0" step="1" onChange={v=>onChange({...thesis,[key]:v})}/>)}
  </div>{number(thesis.bear)!=null&&number(thesis.base)!=null&&number(thesis.bull)!=null&&!(Number(thesis.bear)<=Number(thesis.base)&&Number(thesis.base)<=Number(thesis.bull))&&<p className="opt-warning">Your scenario prices are out of order. Review bear ≤ base ≤ bull before interpreting the comparison.</p>}
  </section>;
}

export function EventStrip({context,expiryDate}) {
  const events=eventsForExpiry(context?.events,expiryDate);
  return <section className="opt-card"><div className="opt-section-label">Events through {expiryDate||'the selected expiry'}</div><h2>What happens before the option expires?</h2>
    {!context?<p className="opt-note">Event data is loading or unavailable.</p>:<>
      {context.stale&&<p className="opt-warning">Showing a previously retrieved event calendar. Recheck dates with the issuer.</p>}
      {context.partial&&<p className="opt-warning">Some event or rate sources are unavailable. Missing dates do not establish an event-free period.</p>}
      {events.length?<div className="opt-event-list">{events.map((e,i)=><div key={`${e.type}-${e.date}-${i}`}><time>{e.date}</time><strong>{e.type}{e.amount!=null?` · ${money(e.amount)}/share`:''}</strong><small>{e.status}{e.timing?` · ${e.timing.toUpperCase()}`:''}</small></div>)}</div>:<p className="opt-note">No upcoming events were returned for this window. This is not confirmation that no event will occur.</p>}
      <p className="opt-note">Earnings dates are provider schedules, subject to change. Undeclared dividends and unscheduled developments may be absent. Ex-dividend dates can affect early call assignment; a low delta does not eliminate it. Sources: <a href="https://site.financialmodelingprep.com/developer/docs/stable/earnings-company" target="_blank" rel="noreferrer">FMP earnings dates</a> and <a href="https://site.financialmodelingprep.com/developer/docs/stable/dividends-company" target="_blank" rel="noreferrer">dividend records</a> · retrieved {context.fetchedAt?.slice(0,10)}.</p>
    </>}
  </section>;
}

export default function DecisionWorkbench({symbol,chain,context,thesis,onThesisChange}) {
  const expiries=[...new Set(chain.options.map(o=>o.expiryDate))].sort();
  const preferred=chain.options.reduce((a,b)=>Math.abs(a.dte-45)<Math.abs(b.dte-45)?a:b,chain.options[0])?.expiryDate;
  const [expiry,setExpiry]=useState(preferred||expiries[0]),[putId,setPutId]=useState(''),[callId,setCallId]=useState('');
  const [count,setCount]=useState('1'),[fee,setFee]=useState('0.65'),[cashRate,setCashRate]=useState('0'),[divCash,setDivCash]=useState('0');
  const [maxSpread,setMaxSpread]=useState('35'),[minOi,setMinOi]=useState('50'),[stressMove,setStressMove]=useState('-20'),[stressVol,setStressVol]=useState('10');
  const contracts=number(count),commission=number(fee),cashYield=number(cashRate),dividendCash=number(divCash);
  const valid=Number.isInteger(contracts)&&contracts>0&&contracts<=1000&&commission>=0&&commission!=null&&cashYield!=null&&cashYield>=0&&dividendCash!=null&&dividendCash>=0;
  const filters={maxSpread:(number(maxSpread)??35)/100,minOi:number(minOi)??50};
  const candidates=useMemo(()=>chooseCandidates(chain,{expiryDate:expiry,buyBelow:number(thesis.buyBelow),sellAbove:number(thesis.sellAbove),fee:commission??0,contracts:contracts??1,...filters}),[chain,expiry,thesis,commission,contracts,maxSpread,minOi]);
  const puts=candidates.filter(o=>o.type==='P'&&o.strike<=chain.spot),calls=candidates.filter(o=>o.type==='C'&&o.strike>=chain.spot);
  const pick=(list,id)=>list.find(o=>o.sym===id)||list.find(o=>o.matches)||list.reduce((a,b)=>Math.abs(Math.abs(a?.delta??0)-.25)<Math.abs(Math.abs(b.delta??0)-.25)?a:b,null);
  const put=pick(puts,putId),call=pick(calls,callId),dte=chain.options.find(o=>o.expiryDate===expiry)?.dte??0;
  const args={spot:chain.spot,put,call,contracts,fee:commission,days:dte,cashRate:cashYield,dividendPerShare:dividendCash};
  const zero=valid?payoffCase({...args,terminal:0}):null,unchanged=valid?payoffCase({...args,terminal:chain.spot}):null;
  const values=[number(thesis.bear),number(thesis.base),number(thesis.bull)].filter(v=>v!=null&&v>=0);
  const max=Math.max(chain.spot*1.5,...values),min=Math.min(chain.spot*.5,...values);
  const prices=[...new Set([...Array.from({length:51},(_,i)=>min+(max-min)*i/50),chain.spot,put?.strike,call?.strike,...values].filter(finite))].sort((a,b)=>a-b);
  const chart=valid?prices.map(price=>({price,...payoffCase({...args,terminal:price})})):[];
  const scenarios=[['Stock falls 30%',chain.spot*.7],['Unchanged',chain.spot],['Stock rises 30%',chain.spot*1.3],...['bear','base','bull'].filter(k=>number(thesis[k])!=null).map(k=>[`${k[0].toUpperCase()+k.slice(1)} case`,Number(thesis[k])])];
  const model=modelInputs(context,chain.spot,dte),move=number(stressMove),volChange=number(stressVol),stressSpot=move!=null?chain.spot*(1+move/100):null,elapsed=Math.floor(dte/2);
  const stressCost=o=>o&&stressSpot>0&&volChange!=null&&model.rate!=null&&model.dividend!=null&&o.iv>0?americanPrice({spot:stressSpot,strike:o.strike,years:(dte-elapsed)/365,iv:Math.max(.01,o.iv+volChange/100),rate:model.rate,dividend:model.dividend,type:o.type}):null;
  const putCost=stressCost(put),callCost=stressCost(call);
  const stressPut=valid&&putCost!=null?contracts*(100*(put.bid-putCost)-2*commission):null;
  const stressCovered=valid&&callCost!=null?contracts*(100*(stressSpot-chain.spot+call.bid-callCost)-2*commission):null;
  return <>
    <ThesisFields thesis={thesis} onChange={onThesisChange}/>
    <section className="opt-card"><div className="opt-section-label">Strike selection / {symbol}</div><h2>Find an entry or exit you would accept</h2><div className="opt-input-grid opt-controls">
      <label className="opt-field">Exact expiration<select value={expiry||''} onChange={e=>{setExpiry(e.target.value);setPutId('');setCallId('');}}>{expiries.map(d=><option key={d}>{d}</option>)}</select></label>
      <Field label="Maximum bid–ask spread (% of midpoint)" value={maxSpread} min="1" max="200" onChange={setMaxSpread}/><Field label="Minimum open interest (contracts)" value={minOi} min="0" onChange={setMinOi}/>
      <Field label="Contracts (100 shares each)" value={count} min="1" max="1000" step="1" onChange={setCount}/><Field label="Fee per contract, per transaction ($)" value={fee} min="0" step="0.05" onChange={setFee}/>
    </div><p className="opt-note">Quotes must have a positive bid, a valid ask, and meet your spread and open-interest filters. Only matching standard contract roots are included. Threshold matches come first; select a row to compare its payoff. The fallback selection is near 25 delta, not a recommendation.</p>
    <div className="opt-two-col">{[['Puts · potential acquisition',puts,put,setPutId,'P'],['Calls · requires shares to cover',calls,call,setCallId,'C']].map(([title,list,selected,setSelected,type])=><div key={type}><h3>{title}</h3><label className="opt-field">Compare contract<select value={selected?.sym||''} onChange={e=>setSelected(e.target.value)}>{!list.length&&<option value="">No eligible contracts</option>}{list.map(o=><option key={o.sym} value={o.sym}>{money(o.strike)} strike · {money(o.bid)} bid{o.matches?' · threshold match':''}</option>)}</select></label>
      <div className="opt-table-wrap"><table className="opt-table"><thead><tr><th>Strike</th><th>Net premium</th><th>{type==='P'?'Effective entry':'Sale strike'}</th><th>Spread</th><th>Your threshold</th></tr></thead><tbody>{list.slice(0,6).map(o=><tr key={o.sym} data-selected={selected?.sym===o.sym}><td><button onClick={()=>setSelected(o.sym)}>{money(o.strike)}</button></td><td>{money(o.premium)}</td><td>{money(type==='P'?o.entry:o.strike)}</td><td>{pct(o.spread*100)}</td><td>{number(thesis[type==='P'?'buyBelow':'sellAbove'])==null?'Not set':o.matches?'Meets':'Outside'}</td></tr>)}</tbody></table></div>
      {selected&&<p className="opt-note">Selected {selected.sym} · bid {money(selected.bid)} / ask {money(selected.ask)} · OI {selected.oi?.toLocaleString()} · volume {selected.vol?.toLocaleString()??'unknown'} · last trade {selected.lastTime||'unavailable'}. Last trade time is not quote time.</p>}
    </div>)}</div>
    {put&&!put.matches&&number(thesis.buyBelow)!=null&&<p className="opt-warning">The selected put’s effective entry exceeds your purchase threshold.</p>}
    {call&&!call.matches&&number(thesis.sellAbove)!=null&&<p className="opt-warning">The selected call’s strike is below your minimum acceptable sale price.</p>}
    </section>
    <EventStrip context={context} expiryDate={expiry}/>
    <section className="opt-card"><div className="opt-section-label">Equal starting capital / held to expiration</div><h2>Compare the whole investment outcome</h2>
      <div className="opt-input-grid"><Field label="Cash and collateral interest assumption (%/year)" value={cashRate} min="0" max="30" step="0.1" onChange={setCashRate}/><Field label="Dividend cash through expiry ($/share)" value={divCash} min="0" step="0.01" onChange={setDivCash}/></div>
      {!valid&&<p className="opt-warning">Enter a positive whole number of contracts and nonnegative fees, interest, and dividends.</p>}
      <div className="opt-metrics"><div><span>Starting capital for every strategy</span><strong>{money(zero?.capital)}</strong><small>{dte} calendar days · {zero?.shares??'—'} shares or equivalent</small></div><div><span>Put net premium / assignment cash</span><strong>{valid&&put?money(contracts*(put.bid*100-commission)):'—'}</strong><small>{put&&valid?`${money(put.strike*100*contracts)} gross assignment obligation`:'No eligible put'}</small></div><div><span>Put P&L if stock reaches zero</span><strong>{money(zero?.shortPut)}</strong><small>Includes selected cash-interest assumption</small></div><div><span>Covered-call P&L if stock reaches zero</span><strong>{money(zero?.coveredCall)}</strong><small>Includes entered dividend cash</small></div></div>
      {chart.length>0&&<div className="opt-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:25,right:25,left:15,bottom:15}}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="price" type="number" domain={['dataMin','dataMax']} tickFormatter={v=>`$${Math.round(v)}`} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>Math.abs(v)>=1000?`$${(v/1000).toFixed(0)}k`:`$${Math.round(v)}`} width={70} stroke="var(--text-secondary)"/><Tooltip labelFormatter={v=>`Stock at expiry: ${money(v)}`} formatter={(v,n)=>[money(v),n]} contentStyle={chartTip}/><Legend/><ReferenceLine y={0} stroke="var(--text-muted)"/>{['bear','base','bull'].filter(k=>number(thesis[k])!=null).map(k=><ReferenceLine key={k} x={Number(thesis[k])} stroke="var(--chart-gold)" strokeDasharray="3 4" label={{value:k,fill:'var(--text-secondary)',fontSize:12}}/>)}{[['stocks','Own shares','var(--chart-blue)'],['shortPut','Cash-secured put','var(--chart-green)'],['coveredCall','Covered call','var(--chart-gold)'],['cash','Keep cash','var(--text-muted)']].map(([key,label,color])=><Line key={key} dataKey={key} name={label} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>}
      <div className="opt-table-wrap"><table className="opt-table"><thead><tr><th>At expiration</th><th>Stock price</th><th>Own shares</th><th>Sell put + cash</th><th>Covered call</th><th>Keep cash</th></tr></thead><tbody>{scenarios.map(([label,terminal])=>{const p=valid?payoffCase({...args,terminal}):null;return <tr key={label}><td>{label}</td><td>{money(terminal)}</td>{['stocks','shortPut','coveredCall','cash'].map(k=><td key={k}>{money(p?.[k])}<small>{p&&finite(p[k])?pct(p[k]/p.capital*100):''}</small></td>)}</tr>;})}</tbody></table></div>
      <p className="opt-note">Each strategy starts with the greater of the share purchase cost and the put’s cash collateral. Unused original cash earns your entered simple rate; premium proceeds earn no interest. Put collateral interest is an assumption—check eligibility with your broker. Stock and covered-call outcomes include entered dividends and assume no early assignment. Put outcomes assume shares are acquired only at expiry. Covered-call returns are measured from today’s stock value, not your tax basis. Taxes, stock-trading fees, slippage, and exercise/assignment fees are excluded. Bid premiums are delayed indications, not guaranteed fills.</p>
    </section>
    <section className="opt-card"><div className="opt-section-label">Before expiration / illustrative stress</div><h2>What if the stock drops and volatility rises?</h2><div className="opt-input-grid"><Field label="Stock move (%)" value={stressMove} min="-95" max="100" onChange={setStressMove}/><Field label="Change in implied volatility (percentage points)" value={stressVol} min="-50" max="100" onChange={setStressVol}/></div>
      <div className="opt-metrics"><div><span>Stressed stock price</span><strong>{money(stressSpot)}</strong><small>{elapsed} days elapsed; {dte-elapsed} days left</small></div><div><span>Short-put mark-to-market P&L</span><strong>{money(stressPut)}</strong><small>Includes entry and closing option fees</small></div><div><span>Shares + short-call P&L</span><strong>{money(stressCovered)}</strong><small>Includes entry and closing option fees</small></div></div>
      <p className="opt-note">American-style binomial model with a continuous dividend-yield proxy from trailing dividends and Treasury rates dated {model.rateDate||'unavailable'}. Volatility changes by the entered amount, with a 1% floor. This is an uncalibrated scenario, not an executable closing quote. It excludes dividends received, interest earned, taxes, spread widening, and discrete dividend timing. If rate, dividend, or volatility inputs are unavailable, model results remain blank.</p>
    </section>
  </>;
}
