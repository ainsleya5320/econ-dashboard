import React,{useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,ReferenceLine,Legend} from 'recharts';
import {effectiveRent,rentalTypeComparison} from '../../lib/rentalAnalysis.js';

const finite=Number.isFinite;
const pct=v=>finite(v)?`${v>=0?'+':''}${v.toFixed(1)}%`:'—';
const share=v=>finite(v)?`${v.toFixed(1)}%`:'—';
const dollars=v=>finite(v)?v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}):'—';
const month=d=>d?new Date(d.slice(0,7)+'-01T00:00:00').toLocaleString('en-US',{month:'short',year:'numeric'}):'Date unavailable';
const tip={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)',borderRadius:4,fontFamily:'var(--font-number)',fontSize:12};

export default function RentalPricing({focus,data,rows,onSelect}) {
  const [years,setYears]=useState(5),[property,setProperty]=useState('multi'),[rent,setRent]=useState(''),[term,setTerm]=useState('12'),[free,setFree]=useState('1');
  const single=focus.rentTypes?.single?.latest,multi=focus.rentTypes?.multi?.latest;
  const comparison=rentalTypeComparison(focus,12*years),concession=data.concessions,national=concession?.shares?.US;
  const difference=finite(focus.concessionShare)&&finite(national)?focus.concessionShare-national:null;
  const baseline=focus.rentTypes?.[property]?.latest?.rent;
  const asking=rent===''?(finite(baseline)?Math.round(baseline):NaN):Number(rent);
  const scenario=effectiveRent(asking,term===''?NaN:Number(term),free===''?NaN:Number(free));
  const dated=concession?.period && Date.now()-Date.parse(concession.period+'-01')>100*86400000;
  return <div className="market-rental-view">
    <div className="market-chart-grid">
      <section className="lab-panel"><div className="lab-section-top"><div><div className="market-edition">Rental pricing / property types</div><h2 style={{marginTop:8}}>Which rents are recovering?</h2></div><div className="market-segment" aria-label="Rental history length">{[3,5].map(y=><button key={y} aria-pressed={years===y} onClick={()=>setYears(y)}>{y}Y</button>)}</div></div>
        <div className="rental-type-facts">{[['Single-family homes',single,'var(--chart-blue)'],['Multifamily rentals',multi,'var(--chart-gold)']].map(([label,p,color])=><div key={label} style={{borderColor:color}}><span>{label}</span><strong>{dollars(p?.rent)}</strong><small>{pct(p?.rentYoy)} year over year · {month(p?.date)}</small></div>)}</div>
        {comparison.history.some(p=>finite(p.single)||finite(p.multi))?<div className="lab-chart" style={{height:290}}><ResponsiveContainer width="100%" height="100%"><LineChart data={comparison.history} margin={{top:12,left:-8,right:14,bottom:5}}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="date" ticks={comparison.history.filter(p=>p.date.endsWith('-01')).map(p=>p.date)} tickFormatter={v=>v.slice(0,4)} tickLine={false} axisLine={false} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>`${v}%`} width={48} tickLine={false} axisLine={false} stroke="var(--text-secondary)"/><ReferenceLine y={0} stroke="var(--text-muted)"/><Tooltip labelFormatter={month} formatter={(v,n)=>[pct(v),n]} contentStyle={tip}/><Legend wrapperStyle={{fontSize:13}}/><Line dataKey="single" name="Single-family" stroke="var(--chart-blue)" strokeWidth={2.5} dot={false} isAnimationActive={false}/><Line dataKey="multi" name="Multifamily" stroke="var(--chart-gold)" strokeWidth={2.5} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>:<div className="lab-empty">Property-type rental histories are unavailable.</div>}
        <p className="lab-note">{finite(comparison.gap)?`Single-family rent growth is ${Math.abs(comparison.gap).toFixed(1)} percentage points ${comparison.gap>=0?'above':'below'} multifamily growth in ${month(comparison.date)}. `:''}These are separate housing samples. Dollar levels are not a like-for-like premium for comparable homes.</p>
        <p className="lab-note">Source: Zillow’s smoothed, seasonally adjusted <a href={data.sources.singleRentHistory} target="_blank" rel="noreferrer">single-family</a> and <a href={data.sources.multiRentHistory} target="_blank" rel="noreferrer">multifamily</a> asking-rent indices. Neither directly adjusts for concessions.</p>
      </section>
      <section className="lab-panel"><div className="market-edition">Incentives / {month(concession?.period)}</div><h2 style={{marginTop:8}}>How common are concessions?</h2>
        <p className="concession-big">{share(focus.concessionShare)}</p><p>of rental listings offered an incentive</p>
        <div className="concession-comparison">{[[focus.name,focus.concessionShare,'var(--chart-gold)'],['United States',national,'var(--chart-blue)']].map(([label,value,color])=><div key={label}><div><span>{label}</span><strong>{share(value)}</strong></div><div className="concession-track"><div style={{width:`${finite(value)?value:0}%`,background:color}}/></div></div>)}</div>
        <div className="lab-insight"><strong>{finite(difference)?`${Math.abs(difference).toFixed(1)} points ${difference>=0?'above':'below'} the national share`:'A comparable concession reading is unavailable'}</strong><p>Incentive frequency helps assess pricing pressure. It does not reveal the size of a discount, whether a lease was signed, or collected rent.</p></div>
        <p className="lab-note">All rental property types combined; this share cannot be assigned separately to apartments or single-family homes. A monthly snapshot is shown, without an invented historical trend.</p>
        {concession&&<p className="lab-note"><a href={concession.url} target="_blank" rel="noreferrer">Zillow monthly rental report</a> · observation {month(concession.period)} · published {concession.publishedAt||'date unavailable'}. The latest linked report is checked when market data refreshes.</p>}
        {dated&&<p className="lab-insight" role="status">This report is more than three months old. Treat it as historical context.</p>}
        {concession?.period&&multi?.date&&concession.period!==multi.date&&<p className="lab-note">The concession report and latest rent index cover different months.</p>}
      </section>
    </div>
    <section className="lab-panel"><div className="lab-section-top"><div><div className="market-edition">Underwriting / editable assumption</div><h2 style={{marginTop:8}}>What does free rent cost?</h2></div><span className="lab-tag">Scenario · not observed effective rent</span></div>
      <div className="rent-scenario-grid"><div className="lab-inputs"><label className="lab-field">Starting rent sample<select value={property} onChange={e=>{setProperty(e.target.value);setRent('');}}><option value="multi">Multifamily rentals</option><option value="single">Single-family homes</option></select></label><label className="lab-field">Advertised monthly rent ($)<input type="number" min="1" step="25" value={rent===''?(finite(baseline)?Math.round(baseline):''):rent} onChange={e=>setRent(e.target.value)}/></label><label className="lab-field">Lease length (months)<input type="number" min="1" max="60" step="1" value={term} onChange={e=>setTerm(e.target.value)}/></label><label className="lab-field">Free rent (months)<input type="number" min="0" max={term||60} step="0.5" value={free} onChange={e=>setFree(e.target.value)}/></label></div><div className="rent-scenario-result" aria-live="polite"><span>Average monthly rent over the lease</span><strong>{dollars(scenario?.monthly)}</strong><p>{scenario?`${scenario.discount.toFixed(1)}% below the advertised rent · ${dollars(scenario.total)} total rent over the lease.`:'Enter a positive rent and lease term; free months must be between zero and the lease length.'}</p></div></div>
      <p className="lab-note">Starts with the selected market’s asking-rent index and an illustrative one month free on a twelve-month lease. Free rent is your assumption; it is not inferred from the concession share above. Excludes fees, bad debt, operating costs, and the timing of payments.</p>
    </section>
    <section className="lab-panel"><h2>Compare rental conditions</h2><p className="lab-note">Rent growth is year over year; concession shares cover {month(concession?.period)}. Select a market to inspect it.</p><div className="lab-table-wrap"><table className="lab-table"><thead><tr><th>Metro</th><th>Single-family YoY</th><th>Multifamily YoY</th><th>Incentive share</th></tr></thead><tbody>{[...rows].sort((a,b)=>(b.concessionShare??-1)-(a.concessionShare??-1)).map(r=><tr key={r.code} data-selected={r.code===focus.code}><td><button onClick={()=>onSelect(r.code)}>{r.name}</button></td>{['single','multi'].map(type=><td key={type}>{pct(r.rentTypes?.[type]?.latest?.rentYoy)}<small className="market-cell-date">{month(r.rentTypes?.[type]?.latest?.date)}</small></td>)}<td>{share(r.concessionShare)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
