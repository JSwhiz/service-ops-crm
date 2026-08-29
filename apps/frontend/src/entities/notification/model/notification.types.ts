export interface AppNotification { id: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; targetUrl: string | null; readAt: string | null; createdAt: string; }
export interface NotificationListResponse { items: AppNotification[]; page: number; limit: number; total: number; totalPages: number; }
