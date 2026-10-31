export interface CounterpartyCreateValues {
  name: string;
  legalName: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

export function toCreateCounterpartyPayload(value: CounterpartyCreateValues): {
  name: string;
  legalName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
} {
  return {
    name: value.name.trim(),
    legalName: value.legalName.trim() || null,
    contactName: value.contactName.trim() || null,
    contactPhone: value.contactPhone.trim() || null,
    notes: value.notes.trim() || null,
  };
}
