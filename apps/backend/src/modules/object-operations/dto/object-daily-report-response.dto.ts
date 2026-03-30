export class ObjectDailyReportResponseDto {
  id!: string;
  objectId!: string;
  reportDate!: string;
  content!: string;
  createdAt!: string;
  updatedAt!: string;
  updatedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
}
