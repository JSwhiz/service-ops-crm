interface DisplayUserLike {
  login?: string | null;
  fullName?: string | null;
  roleCode?: string | null;
}

const TECHNICAL_LOGIN_PATTERN = /^(bootstrap_|test_|seed_|user_)[a-z0-9_-]*/i;

export const USER_ROLE_LABELS: Record<string, string> = {
  founder: 'Учредитель',
  deputy_founder: 'Заместитель учредителя',
  director: 'Директор',
  corporate_director: 'Коммерческий директор',
  deputy_director: 'Заместитель директора',
  manager: 'Менеджер',
  senior_manager: 'Старший менеджер',
  operation_manager: 'Операционный менеджер',
  hr: 'HR',
  sys_admin: 'Системный администратор',
};

export function getUserRoleLabel(roleCode?: string | null): string {
  if (!roleCode) {
    return 'Пользователь';
  }

  return USER_ROLE_LABELS[roleCode] ?? roleCode;
}

export function getUserDisplayName(user?: DisplayUserLike | null): string {
  const fullName = user?.fullName?.trim();

  if (fullName) {
    return fullName;
  }

  const login = user?.login?.trim();

  if (!login || TECHNICAL_LOGIN_PATTERN.test(login)) {
    return getUserRoleLabel(user?.roleCode);
  }

  return login;
}

export function getUserSecondaryLabel(user?: DisplayUserLike | null): string | null {
  const login = user?.login?.trim();
  const fullName = user?.fullName?.trim();

  if (!login || TECHNICAL_LOGIN_PATTERN.test(login) || login === fullName) {
    return null;
  }

  return `@${login}`;
}
