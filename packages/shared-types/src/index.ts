export type Id = string;

export interface BaseEntity {
  id: Id;
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeletableEntity extends BaseEntity {
  deletedAt: string | null;
}
