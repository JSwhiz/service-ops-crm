export interface ObjectFinancialVisibility {
  rates: boolean;
  budget: boolean;
  contract: boolean;
  materials?: boolean;
  contacts?: boolean;
}

const rateFields = new Set([
  'paymentType', 'dailyRate', 'monthlySalary', 'baseDailyRate', 'baseAmount',
  'summerAmount', 'winterAmount', 'summerPaymentType', 'summerDailyRate',
  'summerMonthlySalary', 'winterPaymentType', 'winterDailyRate', 'winterMonthlySalary',
  'baseProfile', 'baseCompensationProfile', 'ratePolicySnapshot', 'policySnapshot',
  'dailyRateSnapshot', 'ratePolicy', 'terms', 'baseAccruedAmount', 'shiftOverrideAmount',
  'paymentScheduleCode', 'paymentScheduleWeekdays', 'paymentScheduleCycleStartDate',
  'summerScheduleCode', 'summerScheduleWeekdays', 'summerScheduleCycleStartDate',
  'winterScheduleCode', 'winterScheduleWeekdays', 'winterScheduleCycleStartDate',
]);
const budgetFields = new Set([
  'monthlyBudget', 'monthlyAmount', 'planAmount', 'actualAmount', 'excessAmount',
  'budgets', 'teamFund', 'teamFunds', 'allocations', 'poolKey',
]);
const sharedMoneyFields = new Set([
  'amount', 'beforeAmount', 'afterAmount', 'difference', 'currentAmount', 'savedAmount',
  'advanceTotal', 'salaryTotal', 'monthTotal', 'rowTotal', 'totalAmount',
  'baseRoundingDifference',
]);
const contractFields = new Set(['contractMonthlyAmount', 'contractAmount']);

/** Historical payloads are nested snapshots, not just top-level changed fields.
 * Return a copy and omit denied values instead of replacing real money by zero. */
export function redactObjectFinancialPayload(value: unknown, visibility: ObjectFinancialVisibility): unknown {
  if (Array.isArray(value)) return value.map(item => redactObjectFinancialPayload(item, visibility));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    (visibility.rates || !rateFields.has(key)) &&
    (visibility.budget || !budgetFields.has(key)) &&
    ((visibility.rates && visibility.budget) || !sharedMoneyFields.has(key)) &&
    (visibility.materials !== false || key !== 'instructionSteps') &&
    (visibility.contacts !== false || !['contacts', 'contact', 'contactId', 'contactName'].includes(key)) &&
    (visibility.contract || !contractFields.has(key)),
  ).map(([key, item]) => [key, redactObjectFinancialPayload(item, visibility)]));
}
