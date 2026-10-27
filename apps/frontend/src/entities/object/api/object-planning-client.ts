import { fetcher } from "@/shared/api/fetcher";

export interface ObjectContact {
  id: string;
  objectId: string;
  name: string;
  position: string | null;
  phones: string[];
  emails: string[];
  links: string[];
  notes: string | null;
  version: number;
}
export type ContactInput = Pick<
  ObjectContact,
  "name" | "phones" | "emails" | "links"
> & { position?: string; notes?: string; expectedVersion?: number };
export interface ObjectPlanning {
  version: number;
  month: string;
  monthlyBudget: number | null;
  actualAmount: number | null;
  excessAmount: number | null;
  automaticSeasons: boolean;
  summerStartsOn: string | null;
  winterStartsOn: string | null;
  activeSeason: string | null;
  capabilities: {
    canEditBudget: boolean;
    canEditSeasons: boolean;
    canViewBudget: boolean;
  };
}
export type PlanningInput = {
  expectedVersion: number;
  monthlyBudget?: number | null;
  automaticSeasons?: boolean;
  summerStartsOn?: string;
  winterStartsOn?: string;
};
export const listObjectContacts = (id: string): Promise<ObjectContact[]> =>
  fetcher(`/objects/${id}/contacts`);
export const saveObjectContact = (
  id: string,
  contactId: string | null,
  payload: ContactInput,
): Promise<ObjectContact> =>
  fetcher(`/objects/${id}/contacts${contactId ? `/${contactId}` : ""}`, {
    method: contactId ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
export const deleteObjectContact = (
  id: string,
  contact: ObjectContact,
): Promise<unknown> =>
  fetcher(`/objects/${id}/contacts/${contact.id}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion: contact.version }),
  });
export const getObjectPlanning = (id: string): Promise<ObjectPlanning> =>
  fetcher(`/objects/${id}/planning`);
export const saveObjectPlanning = (
  id: string,
  payload: PlanningInput,
): Promise<ObjectPlanning> =>
  fetcher(`/objects/${id}/planning`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
