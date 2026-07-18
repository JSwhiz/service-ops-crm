export class OneTimeOrderCompletionPaymentResponseDto {
  id!: string;
  detailsRestricted!: boolean;
  completionId?: string;
  oneTimeOrderId?: string;
  recipient?: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  amount?: number;
  paymentMethod?: string;
  paymentDestination?: string;
  zeroReason?: string | null;
  comment?: string | null;
  differenceReason?: string | null;
  receivedAt?: string;
  recordedBy?: {
    id: string;
    login: string;
    fullName: string;
  };
  status?: string;
  reversalOfPaymentId?: string | null;
  reversedByPaymentId?: string | null;
  correctedFromPaymentId?: string | null;
  correctedByPaymentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export class OneTimeOrderCompletionResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  workCycle!: number;
  completedAt!: string | null;
  completedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  completionComment!: string | null;
  completionSource!: 'native' | 'legacy_unknown';
  status!: string;
  clientRequestId!: string | null;
  payments!: OneTimeOrderCompletionPaymentResponseDto[];
  visibleTotalAmount!: number;
  fullTotalAmountVisible!: boolean;
  createdAt!: string | null;
  updatedAt!: string | null;
}
