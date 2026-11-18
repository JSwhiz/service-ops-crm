/** Presentation-only buckets. Balances remain authoritative server values. */
export function getExpenseMoneyBreakdown(
  expenses: ReadonlyArray<{
    status: string;
    expenseCategory: string | null;
    amount: number;
  }>,
): { confirmedPayouts: number; submittedAmount: number; draftAmount: number } {
  return expenses.reduce(
    (totals, expense) => {
      if (expense.status === 'draft') totals.draftAmount += expense.amount;
      if (expense.status === 'submitted')
        totals.submittedAmount += expense.amount;
      if (
        expense.expenseCategory === 'employee_payout' &&
        (expense.status === 'approved' || expense.status === 'reconciled')
      ) {
        totals.confirmedPayouts += expense.amount;
      }
      return totals;
    },
    { confirmedPayouts: 0, submittedAmount: 0, draftAmount: 0 },
  );
}
