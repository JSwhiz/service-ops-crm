"use client";

import React from "react";

import { useAuth } from "@/shared/auth/use-auth";
import {
  getUserDisplayName,
  getUserRoleLabel,
} from "@/shared/lib/display-name";
import { UserAvatar } from "@/shared/ui/user-avatar/user-avatar";
import { NotificationBell } from "@/features/notification-bell/ui/notification-bell";

export function AppHeader(): React.JSX.Element {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <div className="app-header__title">Рабочая система</div>
      <div className="app-header__meta">
        {user ? <NotificationBell /> : null}
        {user ? <UserAvatar fullName={getUserDisplayName(user)} /> : null}
        <span className="status-pill">{getUserRoleLabel(user?.roleCode)}</span>
        <span>{getUserDisplayName(user)}</span>
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
        >
          Выйти
        </button>
      </div>
    </header>
  );
}
