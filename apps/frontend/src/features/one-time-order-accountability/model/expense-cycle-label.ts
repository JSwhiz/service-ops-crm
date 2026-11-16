export function getExpenseCycleLabel(
  expense: { oneTimeOrderWorkCycle?: number | null; oneTimeOrderCompletionId?: string | null },
  completions: ReadonlyArray<{ id: string; workCycle: number }>,
): string {
  const cycle = expense.oneTimeOrderWorkCycle ?? completions.find(
    (completion) => completion.id === expense.oneTimeOrderCompletionId,
  )?.workCycle;
  if (cycle != null) return `Цикл ${cycle}`;
  if (expense.oneTimeOrderCompletionId) return 'Запись завершения недоступна';
  return 'Без привязки к циклу';
}
