export const ONE_TIME_ORDER_PAYMENT_METHODS = [
  'cash',
  'personal_card_transfer',
  'organization_transfer',
  'other',
] as const;

export type OneTimeOrderPaymentMethod =
  (typeof ONE_TIME_ORDER_PAYMENT_METHODS)[number];
