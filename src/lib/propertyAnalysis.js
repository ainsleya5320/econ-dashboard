// Rates are percentage points; money is dollars. No market forecasts here.
export const DEFAULT_PROPERTY = Object.freeze({
  units: 40, monthlyRent: 2000, vacancy: 5, otherIncome: 20000,
  operatingExpenses: 432000, reserves: 40000, debt: 6500000,
  capRate: 6.5, interest: 7, amortization: 30, maxLtv: 65, minDscr: 1.25,
  closingCosts: 1,
});

export function loanConstant(rate, years) {
  if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(years) || years <= 0) return null;
  const r = rate / 1200, n = years * 12;
  return r === 0 ? 1 / years : 12 * r / -Math.expm1(-n * Math.log1p(r));
}

export function propertyAnalysis(p) {
  if (!p || Object.keys(DEFAULT_PROPERTY).some(k => !Number.isFinite(p[k])) || p.capRate <= 0 || p.minDscr <= 0 || p.maxLtv < 0 || p.maxLtv > 100 || p.vacancy < 0 || p.vacancy > 100 || p.closingCosts < 0 || p.closingCosts > 100 || ['units','monthlyRent','otherIncome','operatingExpenses','reserves','debt'].some(k => p[k] < 0)) return null;
  const constant = loanConstant(p.interest, p.amortization);
  if (constant == null) return null;
  const grossRent = p.units * p.monthlyRent * 12;
  const vacancyLoss = grossRent * p.vacancy / 100;
  const effectiveIncome = grossRent - vacancyLoss + p.otherIncome;
  const noi = effectiveIncome - p.operatingExpenses;
  // Nonpositive NOI cannot support a positive stabilized value or new loan.
  const value = Math.max(0, noi) / (p.capRate / 100);
  const ltvLimit = value * p.maxLtv / 100;
  const dscrLimit = Math.max(0, noi) / (p.minDscr * constant);
  const loan = Math.min(ltvLimit, dscrLimit);
  const fees = loan * p.closingCosts / 100;
  const netProceeds = loan - fees;
  const equityGap = Math.max(0, p.debt - netProceeds);
  const cashOut = Math.max(0, netProceeds - p.debt);
  const debtService = loan * constant;
  const cashFlow = noi - debtService - p.reserves;
  const dscr = debtService > 0 ? noi / debtService : null;
  const incomeForFullRefi = Math.max(
    p.debt / (1 - p.closingCosts / 100) * p.capRate / 100 / (p.maxLtv / 100),
    p.debt / (1 - p.closingCosts / 100) * p.minDscr * constant,
  );
  return { grossRent, vacancyLoss, effectiveIncome, noi, value, ltvLimit, dscrLimit, loan, fees, netProceeds, equityGap, cashOut, debtService, cashFlow, dscr,
    binding: ltvLimit <= dscrLimit ? 'Property value / LTV' : 'Income / debt coverage',
    incomeForFullRefi: Number.isFinite(incomeForFullRefi) ? incomeForFullRefi : null };
}
