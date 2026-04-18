export class OneTimeOrderAuditLogResponseDto {
  id!: string;
  entityType!: string;
  entityId!: string;
  action!: string;
  createdAt!: string;
  actor!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  oldValues!: Record<string, unknown> | null;
  newValues!: Record<string, unknown> | null;
  metadata!: Record<string, unknown> | null;
}
