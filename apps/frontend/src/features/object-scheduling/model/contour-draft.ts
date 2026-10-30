export interface ContourDraft {
  code: string; name: string; dailyRate: string; summerDailyRate: string; winterDailyRate: string;
}
export interface ContourInput {
  code: string; name: string; dailyRate: number; summerDailyRate: number | null; winterDailyRate: number | null;
}
export function newContourDraft(): ContourDraft {
  return { code: `pay_${crypto.randomUUID().slice(0, 8)}`, name: '', dailyRate: '', summerDailyRate: '', winterDailyRate: '' };
}
export function contourPayload(draft: ContourDraft): ContourInput {
  const rate = (value: string): number | null => {
    if (value.trim() === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 100000000) throw new Error('Ставка контура должна быть целым неотрицательным числом не более 100 000 000.');
    return number;
  };
  const dailyRate = rate(draft.dailyRate);
  if (!draft.name.trim()) throw new Error('Укажите название контура оплаты.');
  if (dailyRate === null) throw new Error('Укажите базовую ставку контура оплаты.');
  return { code: draft.code, name: draft.name.trim(), dailyRate, summerDailyRate: rate(draft.summerDailyRate), winterDailyRate: rate(draft.winterDailyRate) };
}
