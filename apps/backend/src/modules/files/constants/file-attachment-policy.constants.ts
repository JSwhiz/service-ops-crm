export const FILE_ATTACHMENT_POLICY = {
  object: {
    fieldCodes: [],
  },
  object_arrival_photo: {
    fieldCodes: [],
  },
  object_daily_report: {
    fieldCodes: [],
  },
  object_comment: {
    fieldCodes: [],
  },
  one_time_order_comment: {
    fieldCodes: [],
  },
  one_time_order_daily_report: {
    fieldCodes: [],
  },
  one_time_order_photo: {
    fieldCodes: [],
  },
  one_time_order_specification_item: {
    fieldCodes: [],
  },
  task: {
    fieldCodes: [],
  },
  task_assignee_completion: {
    fieldCodes: [],
  },
  one_time_order: {
    fieldCodes: [],
  },
  inventory_movement: {
    fieldCodes: [],
  },
  equipment_movement: {
    fieldCodes: [],
  },
  accountability_expense: {
    fieldCodes: [],
  },
  chat_message: {
    fieldCodes: [],
  },
} as const;

export type FileAttachmentEntityType = keyof typeof FILE_ATTACHMENT_POLICY;

export const FILE_ATTACHMENT_ENTITY_TYPES = Object.keys(
  FILE_ATTACHMENT_POLICY,
) as FileAttachmentEntityType[];

export function isFileAttachmentEntityType(
  value: string,
): value is FileAttachmentEntityType {
  return FILE_ATTACHMENT_ENTITY_TYPES.includes(
    value as FileAttachmentEntityType,
  );
}

export function isAllowedFileAttachmentFieldCode(
  entityType: FileAttachmentEntityType,
  fieldCode: string,
): boolean {
  return (FILE_ATTACHMENT_POLICY[entityType].fieldCodes as readonly string[]).includes(
    fieldCode,
  );
}
