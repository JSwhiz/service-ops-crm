export class OneTimeOrderCompletionPaymentResponseDto {
  id!: string;
  completionId!: string;
  oneTimeOrderId!: string;
  recipient!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  amount!: number;
  paymentMethod!: string;
  paymentDestination!: string;
  zeroReason!: string | null;
  comment!: string | null;
  differenceReason!: string | null;
  receivedAt!: string;
  recordedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  status!: string;
  reversalOfPaymentId!: string | null;
  reversedByPaymentId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class OneTimeOrderCompletionResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  workCycle!: number;
  completedAt!: string;
  completedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  completionComment!: string | null;
  status!: string;
  clientRequestId!: string | null;
  payments!: OneTimeOrderCompletionPaymentResponseDto[];
  totalAmount!: number;
  createdAt!: string;
  updatedAt!: string;
}
