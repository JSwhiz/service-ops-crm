export interface ObjectAssignedUser {
  userId: string;
  fullName: string;
  roleCode: string;
}

export interface ServiceObject {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string;
  dailyRate: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  managers: ObjectAssignedUser[];
  responsibles: ObjectAssignedUser[];
}
