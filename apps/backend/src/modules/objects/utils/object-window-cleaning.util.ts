import { BadRequestException } from '@nestjs/common';

export const WINDOW_CLEANING_MODES = ['scheduled', 'on_request', 'notprovided'] as const;
export const WINDOW_CLEANING_SEASONS = ['spring', 'summer', 'autumn'] as const;
export type WindowCleaningMode = typeof WINDOW_CLEANING_MODES[number];
export type WindowCleaningSeason = typeof WINDOW_CLEANING_SEASONS[number];

interface WindowCleaningValues {
  windowCleaningMode?: WindowCleaningMode | null;
  windowCleaningSeasons?: string[];
}

/** Legacy summerWindowCleaning is deliberately not converted into a frequency. */
export function resolveWindowCleaningChange(input: WindowCleaningValues, current?: WindowCleaningValues) {
  if (input.windowCleaningMode === undefined && input.windowCleaningSeasons === undefined) return undefined;
  if (input.windowCleaningSeasons !== undefined && !Array.isArray(input.windowCleaningSeasons)) {
    throw new BadRequestException('Передайте график мытья окон списком выездов');
  }
  const mode = input.windowCleaningMode === undefined ? current?.windowCleaningMode ?? null : input.windowCleaningMode;
  let seasons = input.windowCleaningSeasons ?? current?.windowCleaningSeasons ?? [];
  if (mode !== null && !WINDOW_CLEANING_MODES.includes(mode)) throw new BadRequestException('Выберите режим мытья окон');
  if (!Array.isArray(seasons) || seasons.some(season => !WINDOW_CLEANING_SEASONS.includes(season as WindowCleaningSeason))) {
    throw new BadRequestException('Выберите время года для каждой строки мытья окон');
  }
  if (mode === 'scheduled' && seasons.length === 0) throw new BadRequestException('Добавьте хотя бы одну строку графика мытья окон');
  if (mode !== 'scheduled' && seasons.length) {
    if (input.windowCleaningSeasons?.length) throw new BadRequestException('График мытья окон доступен только в режиме «По графику»');
    seasons = [];
  }
  return { windowCleaningMode: mode, windowCleaningSeasons: [...seasons] };
}
