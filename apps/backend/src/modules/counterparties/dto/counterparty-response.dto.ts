export interface CounterpartyObjectSummaryDto {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
}

export interface CounterpartyListItemDto {
  id: string;
  name: string;
  legalName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  objectCount: number;
  updatedAt: string;
}

export class CounterpartyListResponseDto {
  items!: CounterpartyListItemDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export interface CounterpartyCardResponseDto extends CounterpartyListItemDto {
  notes: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  visibleObjectCount: number;
  objects: CounterpartyObjectSummaryDto[];
  capabilities: {
    canManage: boolean;
    canLinkObjects: boolean;
  };
}

export interface CounterpartyReferenceDto {
  id: string;
  name: string;
  legalName: string | null;
  status: string;
}
