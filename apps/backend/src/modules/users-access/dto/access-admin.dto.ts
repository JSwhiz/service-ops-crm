import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { AccessChange, AccessScope } from "../types/access-policy.type";

export class AccessChangeDto implements AccessChange {
  @IsString() @Length(3, 120) actionCode!: string;
  @IsIn(["allow", "deny", "default"]) effect!: "allow" | "deny" | "default";
  @IsIn(["own", "assigned", "selected", "all"]) scope!: AccessScope;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("all", { each: true })
  selectedIds?: string[];
}
export class PreviewAccessDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @Length(1, 2000) reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AccessChangeDto)
  changes!: AccessChangeDto[];
}
export class SaveAccessDto extends PreviewAccessDto {
  @IsString() @Length(64, 64) previewToken!: string;
  @IsString() @Length(64, 64) previewHash!: string;
}
export class AccessAdminListQueryDto {
  @IsOptional() @IsString() @Length(0, 200) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}
export class AccessResourceQueryDto {
  @IsIn([
    "object",
    "one_time_order",
    "order",
    "user",
    "inventory_item",
    "item",
    "equipment_unit",
    "unit",
    "counterparty",
    "employee",
    "candidate",
    "task",
    "approval",
    "chat_room",
    "file",
  ])
  resourceType!: string;
  @IsOptional() @IsString() @Length(0, 200) q?: string;
  @IsOptional() @IsString() @Length(0, 7500) ids?: string;
}
