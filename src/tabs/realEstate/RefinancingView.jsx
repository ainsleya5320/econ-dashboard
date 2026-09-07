import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { DEFAULT_PROPERTY, propertyAnalysis } from '../../lib/propertyAnalysis.js';




export const money = (v, digits = 2) => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(digits)}m` : `$${Math.round(v).toLocaleString()}`;
export function Metric({ title, value, note, color }) { return <div className="lab-metric" style={color ? {borderColor: color} : {}}><span>{title}</span><strong style={color ? {color} : {}}>{value}</strong><small>{note}</small></div>; }
const fieldGroups = [
  ['Property operations', [['units','Units',1,100000,1],['monthlyRent','Monthly rent / unit ($)',0,100000,25],['vacancy','Vacancy + collection loss (%)',0,100,.5],['otherIncome','Other annual income ($)',0,1e9,1000],['operatingExpenses','Annual operating expenses ($)',0,1e9,1000],['reserves','Annual capital reserve ($)',0,1e9,1000]]],
  ['Refinancing terms', [['debt','Balance due at maturity ($)',0,1e10,50000],['capRate','Valuation cap rate (%)',.5,25,.25],['interest','New interest rate (%)',0,30,.25],['amortization','Amortization (years)',1,50,1],['maxLtv','Maximum loan / value (%)',1,100,1],['minDscr','Minimum debt coverage (×)',1,3,.05],['closingCosts','Closing costs (% of loan)',0,10,.25]]],
];

export default function RefinancingView({p, setP}) {
  const a = useMemo(() => propertyAnalysis(p), [p]);
  const rates = [5,6,7,8,9], caps = [5,5.75,6.5,7.25,8];
  const bars = a ? [
    {name:'Potential rent',value:a.grossRent,color:'var(--chart-blue)'},
    {name:'Collected income',value:a.effectiveIncome,color:'var(--chart-blue)'},
    {name:'Net operating income',value:a.noi,color:'var(--chart-green)'},
    {name:'After debt + reserve',value:a.cashFlow,color:a.cashFlow >= 0 ? 'var(--chart-green)' : 'var(--chart-red)'},
  ] : [];
  return <>
    <div className="lab-section-top"><div><h2>A solvent property can still need new equity.</h2><p>Follow cash from rent to the loan a lender will actually fund.</p></div><span className="lab-tag">Illustrative inputs · editable</span></div>
    {a && <div className="lab-panel"><div className="lab-metrics">
      <Metric title="Equity needed to refinance" value={money(a.equityGap)} note="Includes modeled loan closing costs" color={a.equityGap > 0 ? 'var(--chart-red)' : 'var(--chart-green)'}/>
      <Metric title="New loan capacity" value={money(a.loan)} note={`Limited by ${a.binding.toLowerCase()}`}/>
      <Metric title="Cash after debt + reserve" value={money(a.cashFlow, 3)} note="Annual, before income taxes" color={a.cashFlow >= 0 ? 'var(--chart-green)' : 'var(--chart-red)'}/>
    </div><div className="lab-insight"><strong>{a.noi <= 0 ? 'Operations do not support a stabilized income valuation.' : a.equityGap > 0 ? `${a.binding} is the binding constraint.` : 'The modeled proceeds cover the maturity balance.'}</strong><p>{a.noi > 0 && `At ${p.capRate.toFixed(2)}%, the income implies a ${money(a.value)} property value. `}{a.incomeForFullRefi != null && a.equityGap > 0 ? `NOI would need to reach ${money(a.incomeForFullRefi,3)} to refinance the full balance under both lending limits and fees, versus ${money(a.noi,3)} today.` : a.cashOut > 0 ? `Potential excess proceeds are ${money(a.cashOut)} before other transaction costs.` : 'A lender may impose additional reserves or debt-yield requirements.'}</p></div></div>}
    <div className="lab-columns"><section className="lab-panel">
      <div className="lab-section-top"><h2>Underwriting assumptions</h2><button className="lab-button" onClick={()=>setP({...DEFAULT_PROPERTY})}>Reset</button></div>
      {fieldGroups.map(([group, fields])=><React.Fragment key={group}><h3 style={{marginTop:20}}>{group}</h3><div className="lab-inputs">{fields.map(([key,label,min,max,step])=><label className="lab-field" key={key}>{label}<input type="number" min={min} max={max} step={step} value={Number.isNaN(p[key]) ? '' : p[key]} onChange={e=>setP(v=>({...v,[key]:e.target.value === '' ? NaN : Number(e.target.value)}))}/></label>)}</div></React.Fragment>)}
      <p className="lab-note" style={{marginTop:16}}>Operating expenses include taxes, insurance, management and maintenance; exclude financing and capital reserves. Debt coverage uses NOI before the capital reserve. Loans amortize monthly at a fixed rate. Inputs are scenarios, not a loan quote.</p>
    </section><div>
      {!a ? <div className="lab-empty" role="status">Enter valid, nonnegative inputs; cap rate, coverage and amortization must be positive.</div> : <>
      <section className="lab-panel"><h2>What reaches the owner?</h2><p className="lab-note">Annual cash flow at each stage. Other income is added after vacancy losses.</p><div className="lab-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={bars} layout="vertical" margin={{left:16,right:25,bottom:10}}><CartesianGrid stroke="var(--border-subtle)" horizontal={false}/><XAxis type="number" tickFormatter={v=>money(v,1)} stroke="var(--text-muted)"/><YAxis type="category" dataKey="name" width={135} stroke="var(--text-secondary)" tick={{fontSize:12}}/><Tooltip formatter={v=>money(v,3)} contentStyle={{background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)',borderRadius:8}}/><Bar dataKey="value" name="Annual dollars" radius={[0,4,4,0]}>{bars.map(b=><Cell key={b.name} fill={b.color}/>)}</Bar></BarChart></ResponsiveContainer></div>
      <div className="lab-table-wrap"><table className="lab-table"><tbody>{[['Potential annual rent',a.grossRent],['Less vacancy / collection loss',-a.vacancyLoss],['Plus other income',p.otherIncome],['Less operating expenses',-p.operatingExpenses],['Net operating income',a.noi],['Less new debt service',-a.debtService],['Less capital reserve',-p.reserves],['Cash to owner',a.cashFlow]].map(([label,v])=><tr key={label}><td>{label}</td><td>{money(v,3)}</td></tr>)}</tbody></table></div></section>
      <section className="lab-panel"><h2>The refinancing squeeze</h2><p className="lab-note">Equity required across valuation cap rates and borrowing rates. Click a cell to apply that scenario. Warmer cells need more equity.</p><div className="lab-table-wrap"><table className="lab-table lab-heatmap"><thead><tr><th>Rate ↓ / Cap →</th>{caps.map(c=><th key={c}>{c.toFixed(2)}%</th>)}</tr></thead><tbody>{rates.map(r=><tr key={r}><th>{r.toFixed(1)}%</th>{caps.map(c=>{const b=propertyAnalysis({...p,interest:r,capRate:c});const alpha=.08 + .42*Math.min(1,b.equityGap/Math.max(1,p.debt));return <td key={c}><button aria-label={`${r}% interest, ${c}% cap rate: ${money(b.equityGap)} equity required`} aria-pressed={p.interest===r&&p.capRate===c} onClick={()=>setP(v=>({...v,interest:r,capRate:c}))} style={{background:`rgba(242,160,142,${alpha})`,outline:p.interest===r&&p.capRate===c?'2px solid var(--lab-accent)':undefined}}>{money(b.equityGap)}</button></td>})}</tr>)}</tbody></table></div>
      <p className="lab-note" style={{marginTop:16}}>Loan capacity is the lower of value × maximum LTV and NOI ÷ (minimum coverage × annual loan payment factor). Positive cash flow alone does not guarantee the existing debt can be refinanced.</p></section>
      </>}
    </div></div>
  </>;
}
