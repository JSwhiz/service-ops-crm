export interface RubberMatSizeCreateValues {
  length: string;
  width: string;
  replacementCost: string;
}

export function toCreateRubberMatSizePayload(value: RubberMatSizeCreateValues): {
  lengthCm: number;
  widthCm: number;
  replacementCost: string | null;
} {
  return {
    lengthCm: Number(value.length),
    widthCm: Number(value.width),
    replacementCost: value.replacementCost.trim() || null,
  };
}
