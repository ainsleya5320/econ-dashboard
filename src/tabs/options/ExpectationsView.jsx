import React,{useMemo,useState} from 'react';
import {ResponsiveContainer,ComposedChart,Area,Line,XAxis,YAxis,Tooltip,ReferenceLine,CartesianGrid} from 'recharts';
import {smileDistribution,distributionQuantile,distributionAbove,finite,number} from '../../lib/optionsAnalysis.js';
import {money,modelInputs} from './DecisionWorkbench.jsx';

const pct=v=>finite(v)?`${(100*v).toFixed(1)}%`:'—';
const tip={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)'};
const stamp=date=>Date.parse(date+'T00:00:00Z');
const shortDate=v=>new Date(v).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});

export default function ExpectationsView({symbol,chain,closes,target,model,context,thesis={}}) {
  const [horizon,setHorizon]=useState(90),[rateOverride,setRateOverride]=useState(''),[divOverride,setDivOverride]=useState('');
  const rate=rateOverride===''?model?.rate:number(rateOverride)/100;
  const dividend=divOverride===''?model?.dividend:number(divOverride)/100;
  const curves=useMemo(()=>{
    if(!finite(rate)||!finite(dividend))return [];
    return [...new Set(chain.options.map(o=>o.dte))].filter(d=>d>=3&&d<=400).sort((a,b)=>a-b).map(d=>{
      const r=rateOverride===''?modelInputs(context,chain.spot,d).rate:rate;
      return smileDistribution(chain.options,d,chain.spot,r,dividend);
    }).filter(Boolean);
  },[chain,context,rate,dividend,rateOverride]);
  const nearby=curves.filter(c=>Math.abs(c.dte-horizon)<=Math.max(10,horizon*.3));
  const selected=nearby.sort((a,b)=>Math.abs(a.dte-horizon)-Math.abs(b.dte-horizon))[0];
  const q=p=>selected?distributionQuantile(selected,p):null;
  const above=k=>selected?distributionAbove(selected,k):null;
  const below10=above(chain.spot*.9);
  const fan=[...(closes||[]).slice(-60).filter(p=>p.date<chain.valuationDate).map(p=>({time:stamp(p.date),close:p.close})),{time:stamp(chain.valuationDate),close:chain.spot,median:chain.spot,wide:[chain.spot,chain.spot],middle:[chain.spot,chain.spot]},...curves.map(c=>{
    const p=[.1,.25,.5,.75,.9].map(v=>distributionQuantile(c,v));
    return {time:stamp(c.expiryDate),median:p[2],wide:finite(p[0])&&finite(p[4])?[p[0],p[4]]:null,middle:finite(p[1])&&finite(p[3])?[p[1],p[3]]:null};
  })];
  const density=selected?selected.pts.slice(1).map((p,i)=>({price:(p.K+selected.pts[i].K)/2,density:100*(p.cdf-selected.pts[i].cdf)/(p.K-selected.pts[i].K)})):[];
  const range=(a,b)=>finite(q(a))&&finite(q(b))?`${money(q(a))} – ${money(q(b))}`:'Insufficient strike coverage';
  return <>
    <section className="opt-card"><div className="opt-section-label">Options-implied uncertainty</div><h2>How is uncertainty priced for {symbol}?</h2>
      <p className="opt-note">These are approximate risk-neutral reference distributions: prices for risk under a model. They include the cost of protection and are not real-world forecasts or investment success rates.</p>
      <div className="opt-input-grid">
        <label className="opt-field">Reference horizon<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{[30,60,90,180,365].map(d=><option key={d} value={d}>{d} calendar days</option>)}</select></label>
        <label className="opt-field">Treasury rate override (%/year)<input type="number" step="0.1" value={rateOverride} onChange={e=>setRateOverride(e.target.value)} placeholder={finite(model?.rate)?(model.rate*100).toFixed(2):'Required: source unavailable'}/></label>
        <label className="opt-field">Dividend yield override (%/year)<input type="number" step="0.1" min="0" value={divOverride} onChange={e=>setDivOverride(e.target.value)} placeholder={finite(model?.dividend)?(model.dividend*100).toFixed(2):'Required: source unavailable'}/></label>
      </div>
      <p className="opt-note">Blank overrides use the nearest Treasury tenor for each expiry, dated {model?.rateDate||'unavailable'}, and a trailing dividend-yield proxy. Rates enter the model as continuous yields; this approximation and trailing dividends may differ from the forward curve.</p>
      {!selected&&<p className="opt-warning">No reliable distribution is available near this horizon. Missing inputs, thin strike coverage, or inconsistent quotes can prevent a fit. Try another horizon or symbol.</p>}
      <div className="opt-metrics"><div><span>Actual selected expiration</span><strong>{selected?.expiryDate||'—'}</strong><small>{selected?`${selected.dte} calendar days`:'No qualifying expiry'}</small></div><div><span>Model median price</span><strong>{money(q(.5))}</strong><small>Median in the pricing distribution</small></div><div><span>Middle 50% of model outcomes</span><strong>{range(.25,.75)}</strong><small>Only within observed strike coverage</small></div><div><span>Model weight: finish over 10% lower</span><strong>{below10==null?'—':pct(1-below10)}</strong><small>At expiry; excludes paths and early assignment</small></div></div>
    </section>
    <section className="opt-card"><h2>Price ranges across actual expirations</h2><p className="opt-note">Blue: stock history. Gold: model median. Shading: middle 50% and 80%. Lines connect the available expirations; blank portions have insufficient strike coverage. Your purchase and sale thresholds provide valuation context.</p>
      <div className="opt-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={fan} margin={{top:20,right:30,left:10,bottom:15}}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={shortDate} stroke="var(--text-secondary)"/><YAxis domain={['auto','auto']} tickFormatter={v=>`$${Math.round(v)}`} stroke="var(--text-secondary)" width={75}/><Tooltip labelFormatter={shortDate} formatter={(v,n)=>[Array.isArray(v)?v.map(money).join(' – '):money(v),n]} contentStyle={tip}/>
        <Area dataKey="wide" name="Middle 80%" stroke="none" fill="var(--chart-gold)" fillOpacity={.10} isAnimationActive={false}/><Area dataKey="middle" name="Middle 50%" stroke="none" fill="var(--chart-gold)" fillOpacity={.2} isAnimationActive={false}/><Line dataKey="close" name="Stock price" stroke="var(--chart-blue)" strokeWidth={2} dot={false} isAnimationActive={false}/><Line dataKey="median" name="Model median" stroke="var(--chart-gold)" dot={false} strokeWidth={2} isAnimationActive={false}/>
        {[['buyBelow','Purchase threshold'],['sellAbove','Sale threshold']].filter(([k])=>number(thesis[k])!=null).map(([k,label])=><ReferenceLine key={k} y={Number(thesis[k])} stroke="var(--text-muted)" strokeDasharray="4 4" label={{value:label,fill:'var(--text-secondary)',fontSize:11}}/>)}
      </ComposedChart></ResponsiveContainer></div>
      {target?.targetConsensus>0&&<p className="opt-note">Analyst consensus target: {money(target.targetConsensus)}. Its horizon and update history are not verified here, so it is shown separately from option-expiry scenarios.</p>}
    </section>
    {selected&&<div className="opt-two-col"><section className="opt-card"><h2>Distribution within quoted strikes</h2><p className="opt-note">Model probability density per $1 of stock price for {selected.expiryDate}. Unobserved tails are omitted; the visible area need not total 100%.</p><div className="opt-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={density}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="price" type="number" domain={['dataMin','dataMax']} tickFormatter={v=>`$${Math.round(v)}`} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>`${v.toFixed(1)}%`} stroke="var(--text-secondary)"/><Tooltip labelFormatter={money} formatter={v=>[`${v.toFixed(2)}% per $1`,'Density']} contentStyle={tip}/><Area dataKey="density" stroke="var(--chart-blue)" fill="var(--chart-blue)" fillOpacity={.2} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div></section>
      <section className="opt-card"><h2>What downside is being priced?</h2><p className="opt-note">Approximate risk-neutral weights at {selected.expiryDate}. A dash means the strike lies outside usable coverage.</p><div className="opt-table-wrap"><table className="opt-table"><thead><tr><th>Price level</th><th>Finish below</th><th>Finish above</th></tr></thead><tbody>{[-.2,-.1,-.05,.05,.1,.2].map(move=>{const price=chain.spot*(1+move),p=above(price);return <tr key={move}><td>{money(price)}<small>{move>0?'+':''}{Math.round(move*100)}% from spot</small></td><td>{p==null?'—':pct(1-p)}</td><td>{pct(p)}</td></tr>;})}</tbody></table></div><p className="opt-note">These are terminal-price comparisons. They do not measure touching a price along the way or receiving an exercise assignment.</p></section>
    </div>}
    <section className="opt-card"><details><summary>Method and limitations</summary><p className="opt-note">The model converts per-strike implied volatilities into European reference call prices, prefers out-of-the-money contracts, and derives cumulative weights from the price slopes. A monotone fit removes local inconsistencies; expiries requiring a correction above 20 percentage points are withheld. Usable fits: {curves.length}. Minimum eight strikes; positive two-sided quotes, open interest of at least 50, and spreads no wider than 35% of midpoint. Most listed equity options are American-style; the European reference and continuous dividends are approximations. No tail extrapolation or expected stock return is generated. {selected?`Largest slope correction at this expiry: ${(selected.adjustment*100).toFixed(1)} percentage points.`:''}</p><p className="opt-note">Background: <a href="https://www.newyorkfed.org/research/staff_reports/sr677.html" target="_blank" rel="noreferrer">New York Fed research on option-implied distributions</a>.</p></details></section>
  </>;
}
