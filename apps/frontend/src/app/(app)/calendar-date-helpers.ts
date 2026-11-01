export function shiftIsoDay(value: string, offset: number): string {
  const shifted = new Date(`${value}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

export function resolveIsoDay(value: string | null, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : fallback;
}

export function isoMonthDays(year: number, month: number): string[] {
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = String(month).padStart(2, '0');
  return Array.from({ length: dayCount }, (_, index) =>
    `${year}-${monthText}-${String(index + 1).padStart(2, '0')}`,
  );
}

export function formatIsoDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function visitPlanEmptyCopy(
  date: string,
  canManage: boolean,
  managerSelected: boolean,
): { title: string; description: string } {
  return {
    title: `На ${formatIsoDay(date)} плана нет`,
    description: !canManage
      ? 'Посещения на этот день не запланированы.'
      : managerSelected
        ? 'Создайте план для выбранного менеджера ниже.'
        : 'Выберите менеджера, чтобы создать план на этот день.',
  };
}
