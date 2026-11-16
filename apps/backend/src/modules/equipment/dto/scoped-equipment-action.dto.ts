import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ScopedEquipmentActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** Confirms the scoped write without granting a read of the equipment card. */
export class ScopedEquipmentMovementReceiptDto {
  /** Equipment unit ID; movementId identifies the newly persisted movement. */
  id!: string;
  movementId!: string;
  status!: string;
}
