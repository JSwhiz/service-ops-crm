export class ObjectResponseDto {
  id!: string;
  name!: string;
  internalName!: string | null;
  address!: string;
  status!: string;
  seasonMode!: string;
  notes!: string | null;
  createdAt!: string;
  updatedAt!: string;
  managers!: Array<{
    id: string;
    fullName: string;
    login: string;
  }>;
  responsibles!: Array<{
    id: string;
    fullName: string;
    login: string;
  }>;
}
