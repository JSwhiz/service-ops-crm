export interface ObjectArrivalPhoto {
  id: string;
  objectId: string;
  operationDate: string;
  photoUrl: string;
  photoType: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

export interface ObjectDailyReport {
  id: string;
  objectId: string;
  reportDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

export interface ObjectComment {
  id: string;
  objectId: string;
  content: string;
  commentType: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

export interface ObjectFeedItem {
  type: 'arrival_photo' | 'daily_report' | 'comment';
  id: string;
  occurredAt: string;
  title: string;
  description: string;
  author: {
    id: string;
    login: string;
    fullName: string;
  };
}
