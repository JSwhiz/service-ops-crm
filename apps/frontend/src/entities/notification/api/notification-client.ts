import { fetcher } from '@/shared/api/fetcher';
import type { AppNotification, NotificationListResponse } from '../model/notification.types';

export function listNotifications(page = 1, limit = 20): Promise<NotificationListResponse> { return fetcher(`/notifications?page=${page}&limit=${limit}`); }
export function getNotificationUnreadCount(): Promise<{ count: number }> { return fetcher('/notifications/unread-count'); }
export function markNotificationRead(id: string): Promise<AppNotification> { return fetcher(`/notifications/${id}/read`, { method: 'POST' }); }
export function markAllNotificationsRead(): Promise<{ updated: number }> { return fetcher('/notifications/read-all', { method: 'POST' }); }
