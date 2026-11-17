import { ObjectResponseDto } from './object-response.dto';

export class ObjectListResponseDto {
  items!: ObjectResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
  archiveCounts!: { active: number; archived: number };
}
