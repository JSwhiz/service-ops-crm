export function seasonPlanningPayload(automatic: boolean, summer: string, winter: string): {
  automaticSeasons: boolean; summerStartsOn?: string; winterStartsOn?: string;
} {
  if (!automatic) return { automaticSeasons: false };
  const annual = (value: string): string => {
    const key = value.slice(5);
    const date = new Date(`2001-${key}T00:00:00Z`);
    if (!/^\d{2}-\d{2}$/.test(key) || !Number.isFinite(date.getTime()) || date.toISOString().slice(5, 10) !== key) throw new Error('Задайте действительные ежегодные границы сезонов, кроме 29 февраля.');
    return key;
  };
  const summerStartsOn = annual(summer);
  const winterStartsOn = annual(winter);
  if (summerStartsOn === winterStartsOn) throw new Error('Начало лета и зимы должны различаться.');
  return { automaticSeasons: true, summerStartsOn, winterStartsOn };
}
