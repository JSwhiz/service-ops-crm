export class SpecificationItemCommentResponseDto {
  id!: string;
  itemId!: string;
  content!: string;
  createdAt!: string;
  createdBy!: { id: string; login: string; fullName: string };
}
