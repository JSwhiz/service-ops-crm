export interface TimesheetTotalEntry {
  dayOfMonth: number;
  finalValue: number;
}

export interface TimesheetPeriodTotals {
  advanceTotal: number;
  salaryTotal: number;
  monthTotal: number;
}

export function calculateTimesheetPeriodTotals(
  entries: readonly TimesheetTotalEntry[],
): TimesheetPeriodTotals {
  let advanceTotal = 0;
  let salaryTotal = 0;

  for (const entry of entries) {
    if (entry.dayOfMonth <= 15) {
      advanceTotal += entry.finalValue;
    } else {
      salaryTotal += entry.finalValue;
    }
  }

  return {
    advanceTotal,
    salaryTotal,
    monthTotal: advanceTotal + salaryTotal,
  };
}
