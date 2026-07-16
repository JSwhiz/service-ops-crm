import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import {
  canManageEmployeesHr,
  canViewEmployeesHr,
} from '../employees/utils/employee-hr-access.util';
import { buildApprovalGlobalCapabilities } from '../approvals/utils/approval-capabilities.util';
import { buildAccountabilityGlobalCapabilities } from '../accountability/utils/accountability-capabilities.util';
import { buildInventoryGlobalCapabilities } from '../inventory/utils/inventory-capabilities.util';
import { buildEquipmentGlobalCapabilities } from '../equipment/utils/equipment-capabilities.util';
import { buildChatGlobalCapabilities } from '../chats/utils/chat-capabilities.util';
import { buildOneTimeOrderGlobalCapabilities } from '../one-time-orders/utils/one-time-order-capabilities.util';
import { canCreateObject } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users-access/users.service';

import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuthRequestMeta } from './types/auth-request-meta.type';
import { parseDurationToMs } from './utils/duration.util';
import { verifyPassword } from './utils/password-hash.util';

import { AuthSessionsService } from './auth-sessions.service';

interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  user: MeResponseDto;
}

interface PasswordCheckUserRecord {
  id: string;
  passwordHash: string | null;
}

interface SanitizedAuthUserRecord {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
  permissionCodes: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authSessionsService: AuthSessionsService,
    private readonly prisma: PrismaService,
  ) {}

  async login(
    payload: LoginDto,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const user = await this.usersService.findByLogin(payload.login);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const hasValidPassword = await this.validatePassword(user, payload.password);

    if (!hasValidPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const safeUser = await this.buildMeResponse(
      this.usersService.sanitizeUser(user),
    );

    return this.issueAuthSession(safeUser, meta);
  }

  async refresh(
    refreshToken: string,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const existingSession =
      await this.authSessionsService.findActiveSessionByRawToken(refreshToken);

    if (!existingSession) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(existingSession.userId);

    if (!user || !user.isActive) {
      await this.authSessionsService.revokeSessionByRawToken(refreshToken);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const safeUser = await this.buildMeResponse(
      this.usersService.sanitizeUser(user),
    );
    const refreshExpiresAt = this.getRefreshExpiresAt();
    const rotatedSession = await this.authSessionsService.rotateSession(
      refreshToken,
      {
        expiresAt: refreshExpiresAt,
        meta,
      },
    );

    if (!rotatedSession) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken: await this.signAccessToken(safeUser),
      refreshToken: rotatedSession.rawToken,
      accessExpiresAt: this.getAccessExpiresAt(),
      refreshExpiresAt,
      user: safeUser,
    };
  }

  async getMe(userId: string): Promise<MeResponseDto> {
    const user = await this.usersService.findById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not available');
    }

    return this.buildMeResponse(this.usersService.sanitizeUser(user));
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.authSessionsService.revokeSessionByRawToken(refreshToken);
  }

  private async validatePassword(
    user: PasswordCheckUserRecord,
    rawPassword: string,
  ): Promise<boolean> {
    if (!user.passwordHash) {
      return false;
    }

    return verifyPassword(rawPassword, user.passwordHash);
  }

  private async issueAuthSession(
    user: MeResponseDto,
    meta: AuthRequestMeta,
  ): Promise<IssuedAuthSession> {
    const accessExpiresAt = this.getAccessExpiresAt();
    const refreshExpiresAt = this.getRefreshExpiresAt();
    const refreshSession = await this.authSessionsService.createSession({
      userId: user.id,
      expiresAt: refreshExpiresAt,
      meta,
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: refreshSession.rawToken,
      accessExpiresAt,
      refreshExpiresAt,
      user,
    };
  }

  private async signAccessToken(user: MeResponseDto): Promise<string> {
    return this.jwtService.signAsync(this.buildJwtPayload(user));
  }

  private buildJwtPayload(user: MeResponseDto) {
    return {
      sub: user.id,
      login: user.login,
      roleCode: user.roleCode,
      roleCodes: user.roleCodes,
    };
  }

  private async buildMeResponse(
    user: SanitizedAuthUserRecord,
  ): Promise<MeResponseDto> {
    const activeManagerAssignment =
      await this.prisma.oneTimeOrderAssignment.findFirst({
        where: {
          userId: user.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
        select: { id: true },
      });
    const approvalCapabilities = buildApprovalGlobalCapabilities({
      roleCodes: user.roleCodes,
      permissionCodes: user.permissionCodes,
    });
    const accountabilityCapabilities = buildAccountabilityGlobalCapabilities({
      roleCodes: user.roleCodes,
      permissionCodes: user.permissionCodes,
    });
    const inventoryCapabilities = buildInventoryGlobalCapabilities(
      user.roleCodes,
    );
    const equipmentCapabilities = buildEquipmentGlobalCapabilities(
      user.roleCodes,
    );
    const chatCapabilities = buildChatGlobalCapabilities(user.roleCodes);
    const oneTimeOrderCapabilities = buildOneTimeOrderGlobalCapabilities({
      roleCodes: user.roleCodes,
      permissionCodes: user.permissionCodes,
      hasActiveManagerAssignment: activeManagerAssignment !== null,
    });

    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCode: user.roleCodes[0] ?? 'unknown',
      roleCodes: user.roleCodes,
      capabilities: {
        canAccessApprovals: approvalCapabilities.canAccessApprovals,
        canResolveTaskResultApproval:
          approvalCapabilities.canResolveTaskResultApproval,
        canResolveInventoryApproval:
          approvalCapabilities.canResolveInventoryApproval,
        canResolveObjectChangeApproval:
          approvalCapabilities.canResolveObjectChangeApproval,
        canResolveAccountabilityApproval:
          approvalCapabilities.canResolveAccountabilityApproval,
        canResolveTimesheetApproval:
          approvalCapabilities.canResolveTimesheetApproval,
        canCreateObject: canCreateObject(user.roleCodes),
        canAccessOneTimeOrders:
          oneTimeOrderCapabilities.canAccessOneTimeOrders,
        canCreateOneTimeOrder:
          oneTimeOrderCapabilities.canCreateOneTimeOrder,
        canViewOneTimeOrderCalendar:
          oneTimeOrderCapabilities.canViewOneTimeOrderCalendar,
        canManageOwnOneTimeOrderAvailability:
          oneTimeOrderCapabilities.canManageOwnOneTimeOrderAvailability,
        canManageAnyOneTimeOrderAvailability:
          oneTimeOrderCapabilities.canManageAnyOneTimeOrderAvailability,
        canApproveOneTimeOrderAvailability:
          oneTimeOrderCapabilities.canApproveOneTimeOrderAvailability,
        canAccessEmployeesHr: canViewEmployeesHr(user.roleCodes),
        canManageEmployeesHr: canManageEmployeesHr(user.roleCodes),
        canAccessAccountability:
          accountabilityCapabilities.canAccessAccountability,
        canViewOwnAccountability:
          accountabilityCapabilities.canViewOwnAccountability,
        canIssueAccountabilityFunds:
          accountabilityCapabilities.canIssueAccountabilityFunds,
        canReviewAccountability:
          accountabilityCapabilities.canReviewAccountability,
        canApproveAccountabilityClosure:
          accountabilityCapabilities.canApproveAccountabilityClosure,
        canAccessInventory: inventoryCapabilities.canAccessInventory,
        canManageInventoryCatalog:
          inventoryCapabilities.canManageInventoryCatalog,
        canCreateInventoryMovement:
          inventoryCapabilities.canCreateInventoryMovement,
        canCreateInventoryReceipt:
          inventoryCapabilities.canCreateInventoryReceipt,
        canIssueInventoryToObject:
          inventoryCapabilities.canIssueInventoryToObject,
        canIssueInventoryToOneTimeOrder:
          inventoryCapabilities.canIssueInventoryToOneTimeOrder,
        canReturnInventory: inventoryCapabilities.canReturnInventory,
        canWriteoffInventory: inventoryCapabilities.canWriteoffInventory,
        canAdjustInventory: inventoryCapabilities.canAdjustInventory,
        canViewInventoryReports: inventoryCapabilities.canViewInventoryReports,
        canResolveInventoryMissingPhotoApproval:
          inventoryCapabilities.canResolveInventoryMissingPhotoApproval,
        canAccessEquipment: equipmentCapabilities.canAccessEquipment,
        canManageEquipmentCatalog:
          equipmentCapabilities.canManageEquipmentCatalog,
        canAssignEquipmentToObject:
          equipmentCapabilities.canAssignEquipmentToObject,
        canAssignEquipmentToOneTimeOrder:
          equipmentCapabilities.canAssignEquipmentToOneTimeOrder,
        canReturnEquipment: equipmentCapabilities.canReturnEquipment,
        canMoveEquipment: equipmentCapabilities.canMoveEquipment,
        canMarkEquipmentBroken: equipmentCapabilities.canMarkEquipmentBroken,
        canSendEquipmentToRepair:
          equipmentCapabilities.canSendEquipmentToRepair,
        canReturnEquipmentFromRepair:
          equipmentCapabilities.canReturnEquipmentFromRepair,
        canWriteoffEquipment: equipmentCapabilities.canWriteoffEquipment,
        canViewEquipmentHistory: equipmentCapabilities.canViewEquipmentHistory,
        canAccessChats: chatCapabilities.canAccessChats,
        canManageChats: chatCapabilities.canManageChats,
        canCreateDirectChat: chatCapabilities.canCreateDirectChat,
        canCreateGroupChat: chatCapabilities.canCreateGroupChat,
      },
    };
  }

  private getAccessExpiresAt(): Date {
    return new Date(
      Date.now() + parseDurationToMs(this.getConfigValue('jwt.accessExpiresIn')),
    );
  }

  private getRefreshExpiresAt(): Date {
    return new Date(
      Date.now() +
        parseDurationToMs(this.getConfigValue('jwt.refreshExpiresIn')),
    );
  }

  private getConfigValue(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new Error(`Missing configuration value: ${key}`);
    }

    return value;
  }
}
