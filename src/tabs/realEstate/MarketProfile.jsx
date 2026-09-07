import React, {useMemo, useState} from 'react';
import RentalPricing from './RentalPricing.jsx';
import EmploymentDemand from './EmploymentDemand.jsx';
import {ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend} from 'recharts';

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const pct=v=>finite(v)?`${v>=0?'+':''}${v.toFixed(1)}%`:'—';
const count=v=>finite(v)?Math.round(v).toLocaleString():'—';
const dollars=v=>finite(v)?`$${count(v)}`:'—';
const month=d=>d?new Date(d.slice(0,7)+'-01T00:00:00').toLocaleString('en-US',{month:'short',year:'numeric'}):'Date unavailable';
const tipStyle={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)',borderRadius:4,fontFamily:'var(--font-number)',fontSize:12};

function Fact({label,value,detail,tone}) {
  return <div className="market-fact"><span>{label}</span><strong style={tone?{color:tone}:undefined}>{value}</strong><small>{detail}</small></div>;
}
function Pulse({label,headline,children}) {
  return <div className="market-pulse"><span className="market-edition">{label}</span><h3>{headline}</h3><p>{children}</p></div>;
}

export default function MarketProfile({focus,rows,data,onSelect}) {
  const [peer,setPeer]=useState('US'),[metric,setMetric]=useState('rentYoy'),[years,setYears]=useState(5);
  const [view,setView]=useState('rental');
  const comparison=peer===focus?.code?'US':peer;
  const peerRow=rows.find(r=>r.code===comparison);
  const benchmark= comparison==='US' ? data.nationalHistory : peerRow?.history;
  const peerName=comparison==='US'?'United States':peerRow?.name||'Peer';
  const chart=useMemo(()=>{
    const byMonth=Object.fromEntries((benchmark||[]).map(r=>[r.date,r[metric]]));
    return (focus?.history||[]).slice(-12*years).map(r=>({date:r.date,market:r[metric],peer:byMonth[r.date]??null}));
  },[focus,benchmark,metric,years]);
  const permitBars=useMemo(()=>[['single','Single unit'],['small','2–4 units'],['multi','5+ units']].map(([key,name])=>({name,current:focus?.permitsYtd?.[key]??null,previous:focus?.permitsPreviousYtd?.[key]??null})),[focus]);
  const latestRent=focus?.rentNow,hh=focus?.householdTrend;
  const permitYear=data.permitPeriod?.slice(0,4),permitMonth=data.permitPeriod?new Date(data.permitPeriod+'-01T00:00:00').toLocaleString('en-US',{month:'long'}):null;
  const recentFirming=finite(latestRent?.rentYoy)&&finite(latestRent?.rentMomentum)&&latestRent.rentYoy<0&&latestRent.rentMomentum>0;

  function exportRows(){
    const head=['Metro','CBSA','Rent month','Asking rent USD monthly','Rent YoY percent','Price month','Typical home value USD','Home value YoY percent','Annual permit year','Annual permitted units','Permits per 1000 homes','Housing stock year','Housing units','YTD permit month','YTD permitted units','Same-period prior-year units','YTD permit change percent','ACS household year','Households','Prior ACS household year','Household change','Household change 90pct margin approx','Median renter income USD','Renter share percent'];
    const body=rows.map(r=>[r.name,r.code,r.rentDate,r.rent,r.rentGrowth,r.valueDate,r.homeValue,r.priceGrowth,data.permitYear,r.permits,r.permitsPer1000,data.stockYear,r.units,data.permitPeriod,r.permitsYtd?.total,r.permitsPreviousYtd?.total,r.permitsYtdChange,data.acsYear,r.households,data.acsPreviousYear,r.householdTrend?.change,r.householdTrend?.moe,r.renterIncome,r.renterShare]);
    head.push('Single-family rent month','Single-family asking rent USD','Single-family rent YoY percent','Multifamily rent month','Multifamily asking rent USD','Multifamily rent YoY percent','Concession observation month','Listings offering concessions percent','Concession source');
    rows.forEach((r,i)=>body[i].push(r.rentTypes?.single?.latest?.date,r.rentTypes?.single?.latest?.rent,r.rentTypes?.single?.latest?.rentYoy,r.rentTypes?.multi?.latest?.date,r.rentTypes?.multi?.latest?.rent,r.rentTypes?.multi?.latest?.rentYoy,data.concessions?.period,r.concessionShare,data.concessions?.url));
    const csv=[head,...body].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download='ledger-local-markets.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(!focus)return <div className="lab-empty">Choose an available metro to see the local market brief.</div>;
  return <div className="market-profile">
    <div className="market-profile-top"><div><div className="market-edition">Local market brief / {rows.length} metros</div><h2>{focus.name}</h2><p>{focus.censusName||focus.z}</p></div><div className="market-controls"><label className="lab-field">Market<select value={focus.code} onChange={e=>onSelect(e.target.value)}>{[...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(r=><option key={r.code} value={r.code}>{r.name}</option>)}</select></label><button className="lab-button" onClick={exportRows}>Export market data ↓</button></div></div>
    <div className="market-facts">
      <Fact label="Monthly asking rent" value={dollars(focus.rent)} detail={`${pct(focus.rentGrowth)} year over year · ${month(focus.rentDate)}`}/>
      <Fact label="Typical home value" value={dollars(focus.homeValue)} detail={`${pct(focus.priceGrowth)} year over year · ${month(focus.valueDate)}`}/>
      <Fact label="Recent permit flow" value={pct(focus.permitsYtdChange)} detail={data.permitPeriod?`Jan–${permitMonth} ${permitYear} vs same months last year`:'Latest year-to-date release unavailable'}/>
      <Fact label="Household growth" value={pct(hh?.growth)} detail={`${data.acsPreviousYear||2023} → ${data.acsYear||2024} · ${hh?.clear===false?'direction uncertain':hh?.clear===true?'change exceeds estimated error':'uncertainty unavailable'}`}/>
    </div>
    <nav className="lab-nav market-detail-nav" aria-label="Local market analysis">{[['rental','Rental pricing'],['employment','Jobs & demand'],['overview','Prices, supply & households']].map(([id,label])=><button key={id} data-active={view===id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>
    {view==='rental'&&<RentalPricing key={focus.code} focus={focus} data={data} rows={rows} onSelect={onSelect}/>}
    {view==='employment'&&<EmploymentDemand focus={focus}/>}
    {view==='overview'&&<><div className="market-chart-grid">
      <section className="lab-panel"><div className="lab-section-top"><div><div className="market-edition">01 / Pricing trajectory</div><h2 style={{marginTop:8}}>Is the market turning?</h2></div><div className="market-segment" aria-label="History length">{[3,5].map(y=><button key={y} aria-pressed={years===y} onClick={()=>setYears(y)}>{y}Y</button>)}</div></div>
        <div className="market-chart-controls"><label className="lab-field">Series<select value={metric} onChange={e=>setMetric(e.target.value)}><option value="rentYoy">Asking rent growth</option><option value="priceYoy">Typical home value growth</option></select></label><label className="lab-field">Compare with<select value={comparison} onChange={e=>setPeer(e.target.value)}><option value="US">United States</option>{rows.filter(r=>r.code!==focus.code).sort((a,b)=>a.name.localeCompare(b.name)).map(r=><option key={r.code} value={r.code}>{r.name}</option>)}</select></label></div>
        {chart.some(r=>finite(r.market))?<div className="lab-chart" style={{height:320}}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:15,left:-8,right:14,bottom:5}}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="date" ticks={chart.filter(p=>p.date.endsWith("-01")).map(p=>p.date)} tickFormatter={v=>v.slice(0,4)} minTickGap={65} tickLine={false} axisLine={false} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>`${v}%`} tickLine={false} axisLine={false} width={48} stroke="var(--text-secondary)"/><ReferenceLine y={0} stroke="var(--text-muted)"/><Tooltip labelFormatter={month} formatter={(v,n)=>[pct(v),n]} contentStyle={tipStyle}/><Legend verticalAlign="bottom" wrapperStyle={{fontFamily:'var(--font-body)',fontSize:13,paddingTop:14}}/><Line dataKey="market" name={focus.name} stroke="var(--chart-blue)" strokeWidth={2.8} dot={false} activeDot={{r:5}} isAnimationActive={false}/><Line dataKey="peer" name={peerName} stroke="var(--chart-gold)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>:<div className="lab-empty">Historical observations are unavailable for this series.</div>}
        <p className="lab-note">Year-over-year growth from Zillow’s smoothed, seasonally adjusted indices. Asking rents exclude a direct adjustment for concessions. Home values cover single-family homes and condos; the rental index covers a broader property mix.</p>
      </section>
      <aside className="lab-panel market-reading"><div className="market-edition">Reading the evidence</div>
        <Pulse label="Rents" headline={recentFirming?'Recent firming within an annual decline':finite(focus.rentGrowth)&&focus.rentGrowth<0?'Asking rents remain below last year':'Check the pace of rent growth'}>
          {finite(latestRent?.rentMomentum)?`The last three months imply a ${pct(latestRent.rentMomentum)} annualized pace, versus ${pct(focus.rentGrowth)} over a year. This short-term pace is noisy and is not a forecast.`:'A trend needs comparable monthly observations. Check the source coverage before interpreting the latest reading.'}
        </Pulse>
        <Pulse label="Supply" headline={!finite(focus.permitsYtdChange)?'Recent permit flow unavailable':focus.permitsYtdChange<0?'New authorizations are slowing':'New authorizations are increasing'}>
          {finite(focus.permitsYtdChange)?`${count(focus.permitsYtd.total)} units were permitted through ${permitMonth}, ${pct(focus.permitsYtdChange)} versus the same months last year. Existing construction can still deliver after permitting slows.`:'Annual permit intensity remains available below. A permit is an authorization, not a completed unit.'}
        </Pulse>
        <Pulse label="Demand" headline={finite(hh?.change)&&hh?.clear!==true?'Household change is inconclusive':finite(hh?.change)&&hh.change>0?'A growing household base':finite(hh?.change)?'A smaller household base':'Household trend unavailable'}>
          {finite(hh?.change)?`The ACS estimates ${count(Math.abs(hh.change))} ${hh.change>=0?'more':'fewer'} households in ${data.acsYear} than ${data.acsPreviousYear}. ${finite(hh.moe)?`The approximate 90% margin is ±${count(hh.moe)} households.`:'A margin of error is unavailable.'} This annual survey lags current leasing conditions.`:'The annual household survey could not be paired across years.'}
        </Pulse>
      </aside>
    </div>
    <div className="market-bottom-grid">
      <section className="lab-panel"><div className="market-edition">02 / Supply composition</div><h2 style={{marginTop:8}}>What is being permitted?</h2><p className="lab-note">{data.permitPeriod?`January through ${permitMonth}: ${Number(permitYear)-1} compared with ${permitYear}. Units, not buildings.`:'Recent permit release unavailable.'}</p>
        {focus.permitsYtd&&focus.permitsPreviousYtd?<div className="lab-chart" style={{height:245}}><ResponsiveContainer width="100%" height="100%"><BarChart data={permitBars} margin={{top:10,right:12,left:0,bottom:5}} barGap={5}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="name" axisLine={false} tickLine={false} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>Math.abs(v)>=1000?`${(v/1000).toFixed(0)}k`:v} axisLine={false} tickLine={false} stroke="var(--text-secondary)"/><Tooltip formatter={count} contentStyle={tipStyle}/><Legend wrapperStyle={{fontFamily:'var(--font-body)',fontSize:13}}/><Bar dataKey="previous" name={String(Number(permitYear)-1)} fill="var(--chart-gold)" radius={[2,2,0,0]} maxBarSize={34} isAnimationActive={false}/><Bar dataKey="current" name={permitYear} fill="var(--chart-blue)" radius={[2,2,0,0]} maxBarSize={34} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>:<div className="lab-empty">Comparable year-to-date permit data is unavailable.</div>}
        <p className="lab-note">Buildings with 5+ units can include condos as well as rentals. These counts do not identify completion dates or lease-up schedules.</p>
      </section>
      <section className="lab-panel"><div className="market-edition">03 / Household economics</div><h2 style={{marginTop:8}}>Who supports the rent?</h2>
        <dl className="market-economics"><div><dt>Median renter household income</dt><dd>{dollars(focus.renterIncome)}<small>{data.acsYear} annual dollars · ±{dollars(focus.renterIncomeMoe)} margin</small></dd></div><div><dt>Renter share of occupied homes</dt><dd>{finite(focus.renterShare)?`${focus.renterShare.toFixed(1)}%`:'—'}<small>ACS {data.acsYear}</small></dd></div><div><dt>Annual asking rent / renter income</dt><dd>{finite(focus.askingRentIncome)?`${focus.askingRentIncome.toFixed(1)}%`:'—'}<small>Cross-vintage screening ratio</small></dd></div><div><dt>Occupied households</dt><dd>{count(focus.households)}<small>ACS {data.acsYear} · ±{count(focus.householdsMoe)} margin</small></dd></div></dl>
        <p className="lab-note">The ratio annualizes today’s asking-rent index and divides it by the {data.acsYear} median income of renter households. Dates and housing samples differ; utilities, concessions and later income changes are omitted. This is not an observed household rent-burden measure. ACS margins are 90%.</p>
      </section>
    </div></>}
  </div>;
}
