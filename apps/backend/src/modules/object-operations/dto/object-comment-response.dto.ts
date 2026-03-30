export class ObjectCommentResponseDto {
  id!: string;
  objectId!: string;
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
