export class LinkedOneTimeOrderProjectionDto {
  id!: string;
  title!: string;
  status!: string;
  executionDate!: string | null;
  agreedSum!: number | null;
  canOpenOrderCard!: boolean;
  managers!: Array<{
    userId: string;
    fullName: string;
    roleCode: string;
  }>;
  summary!: {
    commentsCount: number;
    reportsCount: number;
    photosCount: number;
    filesCount: number;
    tasksCount: number;
  };
}
