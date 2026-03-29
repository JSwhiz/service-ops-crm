import { Injectable } from '@nestjs/common';

import { SystemUser } from './types/system-user.type';

@Injectable()
export class UsersService {
  private readonly users: SystemUser[] = [
    {
      id: '1',
      login: 'founder',
      password: 'founder123',
      fullName: 'Учредитель',
      roleCode: 'founder',
      isActive: true,
    },
    {
      id: '2',
      login: 'director',
      password: 'director123',
      fullName: 'Директор',
      roleCode: 'director',
      isActive: true,
    },
  ];

  findByLogin(login: string): SystemUser | undefined {
    return this.users.find((user) => user.login === login);
  }

  findById(id: string): SystemUser | undefined {
    return this.users.find((user) => user.id === id);
  }

  sanitizeUser(user: SystemUser): Omit<SystemUser, 'password'> {
    const { password: _password, ...safeUser } = user;
    return safeUser;
  }
}
