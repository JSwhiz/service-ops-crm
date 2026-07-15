export class OneTimeManagerAvailabilityResponseDto {
  id!: string;
  userId!: string;
  entryType!: string;
  startDate!: string;
  endDate!: string;
  durationDays!: number;
  status!: string;
  requestComment!: string | null;
  resolutionComment!: string | null;
  requestedAt!: string;
  resolvedAt!: string | null;
  cancelledAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  approvalRequestId!: string | null;
  user!: { id: string; login: string; fullName: string };
  requestedBy!: { id: string; login: string; fullName: string };
  resolvedBy!: { id: string; login: string; fullName: string } | null;
  cancelledBy!: { id: string; login: string; fullName: string } | null;
}
