export function effectiveRent(asking,leaseMonths,freeMonths) {
  if(![asking,leaseMonths,freeMonths].every(v=>typeof v==='number'&&Number.isFinite(v))||asking<=0||leaseMonths<=0||freeMonths<0||freeMonths>leaseMonths)return null;
  const total=asking*(leaseMonths-freeMonths);
  return {monthly:total/leaseMonths,total,discount:100*freeMonths/leaseMonths};
}

export function rentalTypeComparison(focus,limit=60) {
  const single=focus?.rentTypes?.single?.history||[],multi=focus?.rentTypes?.multi?.history||[];
  const rows={};
  for(const [key,points] of [['single',single],['multi',multi]])for(const p of points){(rows[p.date]??={date:p.date})[key]=p.rentYoy;}
  const history=Object.values(rows).sort((a,b)=>a.date.localeCompare(b.date));
  // Only describe a gap when both readings are from the same calendar month.
  const latest=history.at(-1),gap=Number.isFinite(latest?.single)&&Number.isFinite(latest?.multi)?latest.single-latest.multi:null;
  return {history:history.slice(-limit),date:latest?.date??null,gap};
}
