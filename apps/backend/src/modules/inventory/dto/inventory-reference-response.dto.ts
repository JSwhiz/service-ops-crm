export class InventoryObjectReferenceResponseDto {
  id!: string;
  name!: string;
  status!: string;
  capabilities!: { canIssueToObject: boolean };
}

export class InventoryOrderReferenceResponseDto {
  id!: string;
  title!: string;
  status!: string;
  capabilities!: { canIssueToOneTimeOrder: boolean; canLinkMovement: boolean };
}
