import React,{useMemo,useState} from 'react';
import {ResponsiveContainer,ComposedChart,Bar,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceLine} from 'recharts';
import {usableOptions,quoteQuality,constantMaturityIv,realizedHistory,finite} from '../../lib/optionsAnalysis.js';
import {money,EventStrip} from './DecisionWorkbench.jsx';

const pct=v=>finite(v)?`${v.toFixed(1)}%`:'—';
const tip={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)'};
export default function IncomeView({symbol,chain,closes,context}) {
  const good=useMemo(()=>usableOptions(chain),[chain]);
  const dates=[...new Set(good.map(o=>o.expiryDate))].sort();
  const nearest=good.reduce((a,b)=>!a||Math.abs(b.dte-45)<Math.abs(a.dte-45)?b:a,null)?.expiryDate;
  const [chosen,setChosen]=useState('');
  const expiry=dates.includes(chosen)?chosen:nearest;
  const at=good.filter(o=>o.expiryDate===expiry),dte=at[0]?.dte;
  const puts=at.filter(o=>o.type==='P'&&o.strike<=chain.spot&&o.strike>=chain.spot*.7).sort((a,b)=>a.strike-b.strike);
  const calls=at.filter(o=>o.type==='C'&&o.strike>=chain.spot&&o.strike<=chain.spot*1.3).sort((a,b)=>a.strike-b.strike);
  const iv=constantMaturityIv(good,chain.spot),rv=realizedHistory(closes).at(-1);
  const gap=iv!=null&&rv?.rv!=null?iv*100-rv.rv:null;
  const term=[...new Set(good.map(o=>o.dte))].filter(d=>d<=400).sort((a,b)=>a-b).map(d=>{
    const rows=good.filter(o=>o.dte===d&&o.iv>0);
    const pair=['P','C'].map(type=>rows.filter(o=>o.type===type).sort((a,b)=>Math.abs(a.strike-chain.spot)-Math.abs(b.strike-chain.spot))[0]).filter(o=>o&&Math.abs(o.strike/chain.spot-1)<.1);
    return {days:d,iv:pair.length?100*pair.reduce((s,o)=>s+o.iv,0)/pair.length:null,date:rows[0]?.expiryDate};
  });
  const bars=[...puts.map(o=>({strike:o.strike,put:100*o.bid/o.strike})),...calls.map(o=>({strike:o.strike,call:100*o.bid/chain.spot}))].sort((a,b)=>a.strike-b.strike);
  return <>
    <section className="opt-card"><div className="opt-section-label">Premium context / {symbol}</div><h2>What risk accompanies the premium?</h2>
      <div className="opt-metrics"><div><span>30-day constant-maturity ATM IV</span><strong>{iv==null?'—':pct(iv*100)}</strong><small>Interpolated total variance; requires bracketing expiries</small></div><div><span>21-session realized volatility</span><strong>{pct(rv?.rv)}</strong><small>Annualized daily-return variability through {rv?.date||'unavailable'}</small></div><div><span>Implied minus recent realized</span><strong>{gap==null?'—':`${gap>=0?'+':''}${gap.toFixed(1)} pp`}</strong><small>{gap==null?'Insufficient data':gap>0?'Above recent realized volatility':'At or below recent realized volatility'}</small></div></div>
      <p className="opt-note">This compares a forward-looking option measure with backward-looking returns. A large gap may reflect event risk or demand for protection; it does not establish that options are overpriced or that selling them will earn an attractive return.</p>
      <div className="opt-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={term}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="days" type="number" domain={['dataMin','dataMax']} tickFormatter={v=>`${v}d`} stroke="var(--text-secondary)"/><YAxis tickFormatter={pct} stroke="var(--text-secondary)"/><Tooltip labelFormatter={v=>`${v} calendar days`} formatter={(v,n,p)=>[pct(v),`ATM IV · ${p.payload.date}`]} contentStyle={tip}/><Line dataKey="iv" stroke="var(--chart-blue)" dot={false} strokeWidth={2} isAnimationActive={false}/>{rv&&<ReferenceLine y={rv.rv} stroke="var(--chart-gold)" strokeDasharray="4 4" label={{value:'Recent realized',fill:'var(--text-secondary)',fontSize:12}}/>}</ComposedChart></ResponsiveContainer></div><p className="opt-note">The term structure shows annualized ATM implied volatility at each actual expiration. A near-term hump may warrant checking the event calendar.</p>
    </section>
    <section className="opt-card"><h2>Premium across acceptable trading quotes</h2><label className="opt-field">Exact expiration<select value={expiry||''} onChange={e=>setChosen(e.target.value)}>{dates.length?dates.map(d=><option key={d}>{d}</option>):<option value="">No eligible expirations</option>}</select></label>
      <p className="opt-note">Gross premium for this {dte??'—'}-day holding period. Put premium is divided by strike collateral; call premium by today’s share value. These are premium yields, not total investment returns. Quotes require a positive bid, a valid ask, at least 50 open contracts, and a spread no wider than 35% of midpoint. Display includes puts and calls within 30% of spot on the out-of-the-money side.</p>
      {bars.length?<div className="opt-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={bars}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="strike" type="number" domain={['dataMin','dataMax']} tickFormatter={v=>`$${Math.round(v)}`} stroke="var(--text-secondary)"/><YAxis tickFormatter={pct} stroke="var(--text-secondary)"/><Tooltip labelFormatter={v=>`Strike ${money(v)}`} formatter={(v,n)=>[pct(v),n]} contentStyle={tip}/><Bar dataKey="put" name="Put period premium / collateral" fill="var(--chart-green)" isAnimationActive={false}/><Bar dataKey="call" name="Call period premium / share value" fill="var(--chart-gold)" isAnimationActive={false}/><ReferenceLine x={chain.spot} stroke="var(--text-muted)" label={{value:'Spot',fill:'var(--text-secondary)',fontSize:12}}/></ComposedChart></ResponsiveContainer></div>:<p className="opt-warning">No contracts pass the quote checks for this window.</p>}
      <div className="opt-two-col">{[['Cash-secured puts',puts,'P'],['Covered calls',calls,'C']].map(([title,rows,type])=><div key={type}><h3>{title}</h3><div className="opt-table-wrap"><table className="opt-table"><thead><tr><th>Strike</th><th>Gross premium / contract</th><th>Period premium yield</th><th>{type==='P'?'Effective entry':'Sale strike + premium'}</th><th>Absolute delta</th><th>Spread</th></tr></thead><tbody>{rows.map(o=><tr key={o.sym}><td>{money(o.strike)}</td><td>{money(o.bid*100)}<small>Bid {money(o.bid)} / ask {money(o.ask)}</small></td><td>{pct(100*o.bid/(type==='P'?o.strike:chain.spot))}</td><td>{money(type==='P'?o.strike-o.bid:o.strike+o.bid)}</td><td>{finite(o.delta)?Math.abs(o.delta).toFixed(2):'—'}</td><td>{pct(100*quoteQuality(o).spread)}<small>OI {o.oi.toLocaleString()}</small></td></tr>)}</tbody></table></div></div>)}</div>
      <p className="opt-note">All figures assume standard 100-share contracts and exclude fees. Call “sale strike + premium” is gross proceeds per share if exercised, not profit. Delta measures the option price response to a $1 stock move; it is not assignment probability. Short puts retain substantial downside and covered calls cap upside while retaining stock losses. Use Valuation &amp; payoffs to compare net outcomes against owning shares or keeping cash.</p>
    </section>
    <EventStrip context={context} expiryDate={expiry}/>
  </>;
}
