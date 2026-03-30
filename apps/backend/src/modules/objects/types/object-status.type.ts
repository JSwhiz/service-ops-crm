export type ObjectStatus = 'active' | 'archived' | 'frozen';

export const OBJECT_STATUSES: ObjectStatus[] = ['active', 'archived', 'frozen'];
export const OBJECT_SEASON_MODES = ['summer', 'winter'] as const;
export type ObjectSeasonMode = (typeof OBJECT_SEASON_MODES)[number];
