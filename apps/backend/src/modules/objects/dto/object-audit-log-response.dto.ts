export class ObjectAuditActorDto {
  id!: string;
  login!: string;
  fullName!: string;
}

export class ObjectAuditLogResponseDto {
  id!: string;
  objectId!: string;
  actionCode!: string;
  createdAt!: string;
  actor!: ObjectAuditActorDto;
  payload!: Record<string, unknown> | null;
}
