export class ObjectFeedItemDto {
  type!: 'arrival_photo' | 'daily_report' | 'comment';
  id!: string;
  occurredAt!: string;
  title!: string;
  description!: string;
  author!: {
    id: string;
    login: string;
    fullName: string;
  };
}
