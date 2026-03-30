export interface ObjectPersonRef {
  id: string;
  fullName: string;
  login: string;
}

export interface ServiceObject {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: 'active' | 'archived' | 'frozen' | string;
  seasonMode: 'summer' | 'winter' | string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  managers: ObjectPersonRef[];
  responsibles: ObjectPersonRef[];
}

export interface ListObjectsQuery {
  search?: string;
  status?: 'active' | 'archived' | 'frozen';
}

export interface CreateObjectPayload {
  name: string;
  internalName?: string;
  address: string;
  seasonMode?: 'summer' | 'winter';
  notes?: string;
  managerUserIds?: string[];
  responsibleUserIds?: string[];
}
