export class OneTimeOrderCommentResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  content!: string;
  commentType!: string;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
}
