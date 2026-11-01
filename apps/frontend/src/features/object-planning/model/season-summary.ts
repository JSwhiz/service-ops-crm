/** Display helpers only. Saved attendance snapshots remain authoritative. */
export function contourDisplayRate(contour: {
  dailyRate: number;
  summerDailyRate: number | null;
  winterDailyRate: number | null;
}, season: string | null): number {
  // The API's active season also represents legacy manual summer/winter objects.
  const seasonal = season === 'summer' ? contour.summerDailyRate : season === 'winter' ? contour.winterDailyRate : null;
  return seasonal ?? contour.dailyRate;
}

export function nextSeasonBoundary(summer: string | null, winter: string | null, now = new Date()): { season: 'summer' | 'winter'; date: string } | null {
  if (!summer || !winter || summer === winter) return null;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const year = Number(today.slice(0, 4));
  const boundaries: { season: 'summer' | 'winter'; date: string }[] = [];
  for (const [season, annual] of [['summer', summer], ['winter', winter]] as const) {
    const check = new Date(`2001-${annual}T12:00:00Z`);
    if (!/^\d{2}-\d{2}$/.test(annual) || !Number.isFinite(check.getTime()) || check.toISOString().slice(5, 10) !== annual) return null;
    const current = `${year}-${annual}`;
    boundaries.push({ season, date: current > today ? current : `${year + 1}-${annual}` });
  }
  return boundaries.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}
