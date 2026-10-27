/** A manager's creation day ends at midnight in Moscow (UTC+3, no DST). */
export function isInventoryPhotoDay(createdAt: Date, now = new Date()): boolean {
  const moscowDay = (date: Date): string =>
    new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return now >= createdAt && moscowDay(createdAt) === moscowDay(now);
}
