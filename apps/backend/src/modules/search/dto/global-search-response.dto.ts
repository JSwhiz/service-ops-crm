export type GlobalSearchEntityType =
  | 'object'
  | 'one_time_order'
  | 'task'
  | 'employee'
  | 'candidate';

export class GlobalSearchItemDto {
  id!: string;
  type!: GlobalSearchEntityType;
  label!: string;
  description!: string | null;
  href!: string;
}

export class GlobalSearchResponseDto {
  query!: string;
  items!: GlobalSearchItemDto[];
}
