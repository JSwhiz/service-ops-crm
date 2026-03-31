export function formatYearMonthLabel(year: number, month: number): string {
  const normalized = String(month).padStart(2, '0');
  return `${normalized}.${year}`;
}

export function getCellDisplayValue(value: number): string {
  return value === 0 ? '' : String(value);
}
