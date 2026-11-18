import type { WindowCleaningMode, WindowCleaningSeason } from '../model/object.types';

export interface WindowCleaningDraft {
  windowCleaningMode: WindowCleaningMode | null;
  windowCleaningSeasons: Array<WindowCleaningSeason | ''>;
}

export const WINDOW_SEASON_OPTIONS = [
  { value: 'spring', label: 'Весна' },
  { value: 'summer', label: 'Лето' },
  { value: 'autumn', label: 'Осень' },
] as const;

export function windowCleaningDraft(item: { windowCleaningMode?: WindowCleaningMode | null; windowCleaningSeasons?: Array<WindowCleaningSeason | ''> }): WindowCleaningDraft {
  return { windowCleaningMode: item.windowCleaningMode ?? null, windowCleaningSeasons: [...(item.windowCleaningSeasons ?? [])] };
}

export function windowCleaningValidation(value: WindowCleaningDraft): string | null {
  if (value.windowCleaningMode !== 'scheduled') return null;
  if (!value.windowCleaningSeasons.length) return 'Добавьте хотя бы один плановый выезд для мытья окон.';
  if (value.windowCleaningSeasons.some(season => !WINDOW_SEASON_OPTIONS.some(option => option.value === season))) return 'Выберите время года для каждого выезда.';
  return null;
}

export function windowCleaningPayload(value: WindowCleaningDraft) {
  const error = windowCleaningValidation(value);
  if (error) throw new Error(error);
  return {
    windowCleaningMode: value.windowCleaningMode,
    windowCleaningSeasons: value.windowCleaningMode === 'scheduled' ? value.windowCleaningSeasons as WindowCleaningSeason[] : [],
  };
}

export function windowCleaningSummary(item: { summerWindowCleaning: boolean; windowCleaningMode?: WindowCleaningMode | null; windowCleaningSeasons?: WindowCleaningSeason[] }): string {
  if (item.windowCleaningMode === 'on_request') return 'По заявке';
  if (item.windowCleaningMode === 'notprovided') return 'Не предусмотрено';
  if (item.windowCleaningMode === 'scheduled') {
    const seasons = item.windowCleaningSeasons ?? [];
    if (!seasons.length) return 'График не заполнен';
    const names = seasons.map(season => WINDOW_SEASON_OPTIONS.find(option => option.value === season)?.label ?? 'Не уточнено');
    return `${seasons.length} ${seasons.length % 10 >= 2 && seasons.length % 10 <= 4 && (seasons.length % 100 < 12 || seasons.length % 100 > 14) ? 'раза' : 'раз'} в год · ${names.join(', ')}`;
  }
  return item.summerWindowCleaning ? 'Летнее мытьё окон · периодичность не указана' : 'Не уточнено';
}
