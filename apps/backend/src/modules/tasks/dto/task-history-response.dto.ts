export class TaskHistoryEventResponseDto {
  id!: string;
  eventType!: string;
  payload!: unknown;
  createdAt!: string;
  actor!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
}
