export const ONE_TIME_ORDER_STATUSES = [
  'new',
  'planned',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type OneTimeOrderStatus =
  (typeof ONE_TIME_ORDER_STATUSES)[number];
