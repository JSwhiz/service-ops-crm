export interface ObjectAssignmentPerson {
  userId: string;
  fullName: string;
  roleCode: string;
}

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
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
  responsibles: ObjectAssignmentPerson[];
  managers: ObjectAssignmentPerson[];
}
