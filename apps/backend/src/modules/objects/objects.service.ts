import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { projectCommittedWrite, type SavedWithoutAccess } from '../../common/access/project-committed-write';
import { loadAccessSubject } from '../../common/access/notification-access';
import { objectDelegationContext, type ObjectDelegationGrant } from '../user-substitutions/object-delegation.context';
import { resolveObjectDelegationGrants } from '../user-substitutions/resolve-object-delegation-grants.util';
import { decideAccess } from '../users-access/utils/access-policy.util';
import { canEnterAccessModule } from '../users-access/utils/access-summary.util';

import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';
import {
  OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
  OBJECT_CHANGE_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import {
  canLinkCounterpartyObjects,
  canViewCounterparties,
} from '../counterparties/utils/counterparty-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { delegatedObjectIds, hasDelegatedObjectAction, ObjectDelegatedAction } from '../user-substitutions/object-delegation.context';
import { getScheduleConfigurationError } from '../timesheets/utils/russian-production-calendar.util';

import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { CreateObjectDto } from './dto/create-object.dto';
import { ObjectCreateCapabilitiesDto } from './dto/object-create-capabilities.dto';
import { canManageEmployeeAssignments, canViewEmployeesHr } from '../employees/utils/employee-hr-access.util';
import { ObjectSetupService } from './object-setup.service';
import { ObjectSchedulingService } from '../object-scheduling/object-scheduling.service';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectAuditLogResponseDto } from './dto/object-audit-log-response.dto';
import { ObjectListResponseDto } from './dto/object-list-response.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import {
  canBeObjectManager,
  buildObjectAccessPolicyWhere,
  canCreateObject,
  canEditObject,
  canEditObjectDailyRate,
  canViewObjectCompensationRates,
  canManageObjectResponsibles,
  canOverrideFrozenObject,
  hasHrObjectView,
  hasWideObjectAccess,
  LEADERSHIP_OBJECT_ROLE_CODES,
} from './utils/object-access.util';
import { buildObjectCapabilities } from './utils/object-capabilities.util';
import { redactObjectFinancialPayload } from './utils/object-financial-redaction.util';
import { annualSeason, baseCompensation, moscowDateKey, validAnnualDate } from './utils/object-season.util';
import { objectRegistryArchiveState, objectRegistryArchiveWhere } from './utils/object-registry-query.util';
import { resolveWindowCleaningChange, type WindowCleaningMode } from './utils/object-window-cleaning.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
  accessVersion?: number;
}

interface ObjectAssignmentView {
  assignmentRoleCode: string;
  user: {
    id: string;
    login: string;
    fullName: string;
    roles?: Array<{
      role: {
        code: string;
      };
    }>;
  };
}

interface ObjectView {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string | null;
  baseCompensationProfile: Prisma.JsonValue | null;
  summerWindowCleaning: boolean;
  windowCleaningMode: WindowCleaningMode | null;
  windowCleaningSeasons: string[];
  engineeringRequired: boolean;
  winterTractorMode: 'none' | 'with_removal' | 'without_removal';
  instructionSteps: string[];
  paymentType: 'monthly' | 'daily';
  dailyRate: number;
  monthlySalary: number;
  paymentScheduleCode: string | null;
  paymentScheduleWeekdays: string[];
  paymentScheduleCycleStartDate: Date | string | null;
  summerPaymentType: 'monthly' | 'daily';
  summerDailyRate: number;
  summerMonthlySalary: number;
  summerScheduleCode: string | null;
  summerScheduleWeekdays: string[];
  summerScheduleCycleStartDate: Date | string | null;
  winterPaymentType: 'monthly' | 'daily';
  winterDailyRate: number;
  winterMonthlySalary: number;
  winterScheduleCode: string | null;
  winterScheduleWeekdays: string[];
  winterScheduleCycleStartDate: Date | string | null;
  notes: string | null;
  counterpartyId: string | null;
  masterForCounterpartyId?: string | null;
  counterparty?: {
    id: string;
    name: string;
    legalName: string | null;
    status: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  assignments: ObjectAssignmentView[];
  employeeAssignments?: Array<{
    employee: {
      id: string;
      fullName: string;
      position: string | null;
      baseDailyRate: number | null;
      workScheduleCode: string | null;
      workScheduleCustom: string | null;
      workTimeText: string | null;
    };
  }>;
}

type AuditPrimitive = Prisma.InputJsonValue | null;

type ObjectUpdateChangeSet = Record<
  string,
  {
    oldValue: AuditPrimitive;
    newValue: AuditPrimitive;
  }
>;

interface ObjectScheduleProfile {
  paymentScheduleCode: string | null;
  paymentScheduleWeekdays: string[];
  paymentScheduleCycleStartDate: Date | string | null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function formatDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

const OBJECT_COMPENSATION_UPDATE_FIELDS = new Set([
  'seasonMode',
  'paymentType', 'dailyRate', 'monthlySalary',
  'paymentScheduleCode', 'paymentScheduleWeekdays',
  'paymentScheduleCycleStartDate',
  'summerPaymentType', 'summerDailyRate', 'summerMonthlySalary',
  'summerScheduleCode', 'summerScheduleWeekdays',
  'summerScheduleCycleStartDate',
  'winterPaymentType', 'winterDailyRate', 'winterMonthlySalary',
  'winterScheduleCode', 'winterScheduleWeekdays',
  'winterScheduleCycleStartDate',
]);

function resolveActiveScheduleProfile(
  seasonMode: string | null,
  defaultProfile: ObjectScheduleProfile,
  summerProfile: ObjectScheduleProfile,
  winterProfile: ObjectScheduleProfile,
): ObjectScheduleProfile {
  const selectedProfile = seasonMode === 'summer'
    ? summerProfile
    : seasonMode === 'winter'
      ? winterProfile
      : defaultProfile;

  // Older records may have no seasonal schedule data. Keep their default
  // schedule as the compatibility source; explicit weekdays remain seasonal.
  if (
    seasonMode !== null &&
    selectedProfile.paymentScheduleCode === null &&
    selectedProfile.paymentScheduleWeekdays.length === 0 &&
    selectedProfile.paymentScheduleCycleStartDate === null
  ) {
    return defaultProfile;
  }

  return selectedProfile;
}

@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly chatsService: ChatsService,
    private readonly notificationsService: NotificationsService,
    private readonly objectSetup: ObjectSetupService,
    private readonly scheduling: ObjectSchedulingService,
  ) {}

  async listObjects(
    currentUser: CurrentAuthUser,
    query?: ListObjectsQueryDto,
  ): Promise<ObjectResponseDto[] | ObjectListResponseDto> {
    const search = (query?.q ?? query?.search ?? '').trim();
    const filters: Prisma.ObjectWhereInput[] = [
      await this.buildVisibilityWhere(currentUser),
    ];

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          {
            internalName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          { address: { contains: search, mode: 'insensitive' } },
          {
            assignments: {
              some: {
                isActive: true,
                assignmentRoleCode: { in: ['responsible', 'manager'] },
                user: {
                  isActive: true,
                  deletedAt: null,
                  OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { login: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    const baseWhere: Prisma.ObjectWhereInput = { AND: filters };
    const filteredWhere: Prisma.ObjectWhereInput = query?.status ? { AND: [baseWhere, { status: query.status }] } : baseWhere;
    const where = objectRegistryArchiveWhere(filteredWhere, objectRegistryArchiveState(query));
    const shouldPaginate =
      query?.q !== undefined ||
      query?.page !== undefined ||
      query?.limit !== undefined ||
      query?.sortBy !== undefined ||
      query?.sortDirection !== undefined;

    if (!shouldPaginate) {
      const objects = (await this.prisma.object.findMany({
        where,
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
          employeeAssignments: this.getEmployeeAssignmentsInclude(),
          counterparty: {
            select: { id: true, name: true, legalName: true, status: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })) as ObjectView[];

      return objects.map((item) => this.mapObject(item, currentUser));
    }

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const sortBy = query?.sortBy ?? 'updatedAt';
    const sortDirection = query?.sortDirection ?? 'desc';
    const orderBy = [
      { [sortBy]: sortDirection },
      { id: 'asc' },
    ] as Prisma.ObjectOrderByWithRelationInput[];
    const [total, activeCount, archivedCount, objects] = await this.prisma.$transaction([
      this.prisma.object.count({ where }),
      this.prisma.object.count({ where: objectRegistryArchiveWhere(baseWhere, 'active') }),
      this.prisma.object.count({ where: objectRegistryArchiveWhere(baseWhere, 'archived') }),
      this.prisma.object.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
          employeeAssignments: this.getEmployeeAssignmentsInclude(),
          counterparty: {
            select: { id: true, name: true, legalName: true, status: true },
          },
        },
      }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    return {
      items: (objects as ObjectView[]).map((item) =>
        this.mapObject(item, currentUser),
      ),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      archiveCounts: { active: activeCount, archived: archivedCount },
    };
  }

  async getObjectById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectResponseDto> {
    const object = (await this.prisma.object.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
        employeeAssignments: this.getEmployeeAssignmentsInclude(),
        counterparty: {
          select: { id: true, name: true, legalName: true, status: true },
        },
      },
    })) as ObjectView | null;

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return this.mapObject(object, currentUser);
  }

  async listObjectAuditLogs(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectAuditLogResponseDto[]> {
    const visibleOperationalObject = await this.prisma.object.findFirst({
      where: {
        id,
        AND: [
          { OR: [this.buildOperationalVisibilityWhere(currentUser), buildObjectAccessPolicyWhere(currentUser,
            currentUser.permissionCodes?.includes('objects.hr_reports_view') ? { deletedAt: null } : { id: { in: [] } }, 'objects.hr_reports_view')] },
          buildObjectAccessPolicyWhere(currentUser, {}, 'objects.history'),
          buildObjectAccessPolicyWhere(currentUser, {}, 'objects.read'),
        ],
      },
      select: {
        id: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    if (!visibleOperationalObject) {
      throw new NotFoundException('Object not found');
    }

    const canViewRates = canViewObjectCompensationRates({
      subject: currentUser,
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
      object: visibleOperationalObject,
    });
    const financialContext = {
      resourceType: 'object', resourceId: id, ownerUserId: visibleOperationalObject.createdByUserId,
      assignedUserIds: visibleOperationalObject.assignments.map(assignment => assignment.userId),
    };
    const legacyFinancialRead = canViewObjectCompensationRates({
      currentUserId: currentUser.id, roleCodes: this.getRoleCodes(currentUser), object: visibleOperationalObject,
    });
    const canViewBudget = decideAccess(currentUser, 'objects.budget.read', legacyFinancialRead, financialContext);
    const canViewContract = decideAccess(currentUser, 'objects.contract_amount.read',
      this.getRoleCodes(currentUser).some(role => (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role)), financialContext);
    const canViewMaterials = decideAccess(currentUser, 'objects.materials.read', true, financialContext);
    const canViewContacts = decideAccess(currentUser, 'objects.contacts.read', true, financialContext);
    const items = await this.auditService.listObjectAuditLogs(id);

    return items.map((item) => ({
      id: item.id,
      objectId: item.objectId,
      actionCode: item.actionCode,
      createdAt: item.createdAt.toISOString(),
      actor: {
        id: item.actor.id,
        login: item.actor.login,
        fullName: item.actor.fullName,
      },
      payload: item.payload && typeof item.payload === 'object' &&
          (canViewContacts || !/^object\.contacts?\./.test(item.actionCode)) &&
          (canViewRates || !item.actionCode.startsWith('compensation.version.')) &&
          (canViewBudget || !item.actionCode.startsWith('compensation.team_fund.')) &&
          ((canViewRates && canViewBudget) || !item.actionCode.startsWith('compensation.') ||
            item.actionCode.startsWith('compensation.version.') || item.actionCode.startsWith('compensation.team_fund.')) &&
          this.objectAuditEmployeesReadable(currentUser, item.payload)
        ? redactObjectFinancialPayload(item.payload, {rates: canViewRates, budget: canViewBudget, contract: canViewContract, materials: canViewMaterials, contacts: canViewContacts}) as Record<string, unknown>
        : null,
    }));
  }

  async creationCapabilities(currentUser: CurrentAuthUser, payload: ObjectCreateCapabilitiesDto) {
    const roles = this.getRoleCodes(currentUser);
    const permissions = currentUser.permissionCodes ?? [];
    const before = { resourceType: 'object', ownerUserId: currentUser.id };
    const assigned = [...new Set([payload.responsibleUserId ?? currentUser.id, ...payload.managerUserIds.filter(id => id !== currentUser.id)])];
    const after = { ...before, assignedUserIds: assigned };
    const base = decideAccess(currentUser, 'objects.create', canCreateObject(roles)) &&
      decideAccess(currentUser, 'objects.read', true, after) &&
      (payload.status !== 'archived' || decideAccess(currentUser, 'objects.archive', true, before)) &&
      (payload.status !== 'frozen' || decideAccess(currentUser, 'objects.freeze', true, before));
    const rates = base && decideAccess(currentUser, 'objects.rates.manage', canEditObjectDailyRate(roles), before);
    const setup = ObjectSetupService.capabilities(currentUser, {
      id: '', createdByUserId: currentUser.id, status: payload.status, assignments: [],
    });
    const setupAllowed = base && canCreateObject(roles);
    const schedWritable = payload.status === 'active';
    const schedule = base && schedWritable && decideAccess(currentUser, 'objects.schedules.manage', true, after);
    const contours = rates && schedWritable && decideAccess(currentUser, 'objects.rates.manage', canEditObjectDailyRate(roles), after);
    // createObject removes the actor from managerUserIds before assignments.
    const selectPayConditions = base && schedWritable && decideAccess(currentUser, 'objects.pay_conditions.select', canEditObjectDailyRate(roles), after);
    const eligible = payload.employeeIds.length ? await this.prisma.employee.findMany({
      where: { id: { in: payload.employeeIds }, deletedAt: null, employmentStatus: 'active' }, select: { id: true },
    }) : [];
    const eligibleIds = new Set(eligible.map((employee) => employee.id));
    const canAssign = canManageEmployeeAssignments(permissions);
    const employees = Object.fromEntries(payload.employeeIds.map((id) => [id,
      schedule && eligibleIds.has(id) &&
      decideAccess(currentUser, 'employees.view', canViewEmployeesHr(permissions), { resourceType: 'employee', resourceId: id }) &&
      decideAccess(currentUser, 'objects.staffing.manage', canAssign, { resourceType: 'object' }) &&
      decideAccess(currentUser, 'employees.assignments.manage', canAssign, { resourceType: 'employee', resourceId: id }),
    ]));
    return { base, rates, materials: base && decideAccess(currentUser, 'objects.materials.manage', true, before),
      setup: { core: setupAllowed && setup.canEditCore, contract: setupAllowed && setup.canEditContractAmount,
        budgets: setupAllowed && setup.canEditBudgets, coefficient: setupAllowed && setup.canEditCoefficient },
      schedule, contours, selectPayConditions, counterparty: base && canEnterAccessModule(currentUser,
        'counterparties.access', ['counterparties.objects.link'], canLinkCounterpartyObjects(permissions)),
      preview: currentUser.isActive && canCreateObject(roles), employees };
  }

  async createObject(
    currentUser: CurrentAuthUser,
    payload: CreateObjectDto,
  ): Promise<ObjectResponseDto | SavedWithoutAccess> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!decideAccess(currentUser, 'objects.create', canCreateObject(roleCodes))) {
      throw new ForbiddenException('Object creation denied');
    }
    const creationContext = { resourceType: 'object', ownerUserId: currentUser.id };
    if (payload.status === 'archived' && !decideAccess(currentUser, 'objects.archive', true, creationContext)) throw new ForbiddenException('Initial object archive denied');
    if (payload.status === 'frozen' && !decideAccess(currentUser, 'objects.freeze', true, creationContext)) throw new ForbiddenException('Initial object freeze denied');
    if (Object.entries(payload).some(([field, value]) => value !== undefined && OBJECT_COMPENSATION_UPDATE_FIELDS.has(field)) &&
        !decideAccess(currentUser, 'objects.rates.manage', canEditObjectDailyRate(roleCodes), creationContext)) throw new ForbiddenException('Initial object rates denied');
    if (payload.instructionSteps !== undefined && !decideAccess(currentUser, 'objects.materials.manage', true, creationContext)) throw new ForbiddenException('Initial object instructions denied');

    const planning = payload.planning;
    if (planning) {
      if (!decideAccess(currentUser, 'objects.rates.manage', canEditObjectDailyRate(roleCodes), creationContext)) {
        throw new ForbiddenException('Изменение сезонов недоступно');
      }
      if (planning.automaticSeasons && (!planning.summerStartsOn || !planning.winterStartsOn)) {
        throw new BadRequestException('Укажите даты начала лета и зимы');
      }
      if ((planning.summerStartsOn && !validAnnualDate(planning.summerStartsOn)) ||
          (planning.winterStartsOn && !validAnnualDate(planning.winterStartsOn)) ||
          (planning.summerStartsOn && planning.summerStartsOn === planning.winterStartsOn)) {
        throw new BadRequestException('Укажите разные корректные даты начала сезонов');
      }
    }
    const initialSeason = planning
      ? planning.automaticSeasons
        ? annualSeason(planning.summerStartsOn!, planning.winterStartsOn!)
        : null
      : payload.seasonMode ?? null;
    if (planning && payload.seasonMode != null && payload.seasonMode !== initialSeason) {
      throw new BadRequestException('При сезонности активный сезон определяется автоматически');
    }

    const responsibleUser = await this.getAssignableResponsibleUser(
      payload.responsibleUserId ?? currentUser.id,
    );

    if (payload.counterpartyId) {
      await this.assertCounterpartyCanBeLinked(
        currentUser,
        payload.counterpartyId,
      );
    }

    const managerUserIds = Array.from(
      new Set((payload.managerUserIds ?? []).filter(Boolean)),
    ).filter((userId) => userId !== currentUser.id);

    const managerUsers =
      managerUserIds.length > 0
        ? await this.prisma.user.findMany({
            where: {
              id: { in: managerUserIds },
              isActive: true,
            },
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          })
        : [];

    if (managerUsers.length !== managerUserIds.length) {
      throw new NotFoundException(
        'One or more selected managers were not found',
      );
    }

    for (const manager of managerUsers) {
      const roleCodesOfManager = manager.roles.map((item) => item.role.code);

      if (!canBeObjectManager(roleCodesOfManager)) {
        throw new ForbiddenException('Selected user cannot be object manager');
      }
    }

    const defaultScheduleProfile = {
      paymentScheduleCode: payload.paymentScheduleCode ?? null,
      paymentScheduleWeekdays: payload.paymentScheduleWeekdays ?? [],
      paymentScheduleCycleStartDate: parseDateOnly(payload.paymentScheduleCycleStartDate),
    };
    const summerScheduleProfile = {
      paymentScheduleCode: payload.summerScheduleCode !== undefined ? payload.summerScheduleCode : defaultScheduleProfile.paymentScheduleCode,
      paymentScheduleWeekdays: payload.summerScheduleWeekdays ?? defaultScheduleProfile.paymentScheduleWeekdays,
      paymentScheduleCycleStartDate: payload.summerScheduleCycleStartDate !== undefined ? parseDateOnly(payload.summerScheduleCycleStartDate) : defaultScheduleProfile.paymentScheduleCycleStartDate,
    };
    const winterScheduleProfile = {
      paymentScheduleCode: payload.winterScheduleCode !== undefined ? payload.winterScheduleCode : defaultScheduleProfile.paymentScheduleCode,
      paymentScheduleWeekdays: payload.winterScheduleWeekdays ?? defaultScheduleProfile.paymentScheduleWeekdays,
      paymentScheduleCycleStartDate: payload.winterScheduleCycleStartDate !== undefined ? parseDateOnly(payload.winterScheduleCycleStartDate) : defaultScheduleProfile.paymentScheduleCycleStartDate,
    };
    for (const [label, profile] of [
      ['Базовый график', defaultScheduleProfile],
      ['Летний график', summerScheduleProfile],
      ['Зимний график', winterScheduleProfile],
    ] as const) {
      const error = getScheduleConfigurationError({
        scheduleCode: profile.paymentScheduleCode,
        scheduleWeekdays: profile.paymentScheduleWeekdays,
        scheduleCycleStartDate: profile.paymentScheduleCycleStartDate,
      });
      if (error) throw new BadRequestException(`${label}: ${error}`);
    }
    const activeScheduleProfile = resolveActiveScheduleProfile(
      initialSeason,
      defaultScheduleProfile,
      summerScheduleProfile,
      winterScheduleProfile,
    );

    const windowCleaning = resolveWindowCleaningChange(payload);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockActorAccessRevision(tx, currentUser);
      const object = await tx.object.create({
        data: {
          name: payload.name,
          internalName: payload.internalName ?? null,
          address: payload.address,
          status: payload.status ?? 'active',
          seasonMode: initialSeason,
          baseCompensationProfile: {
            paymentType: payload.paymentType ?? ((payload.monthlySalary ?? 0) > 0 ? 'monthly' : 'daily'), dailyRate: payload.dailyRate ?? 0, monthlySalary: payload.monthlySalary ?? 0,
            ...defaultScheduleProfile, paymentScheduleCycleStartDate: formatDateOnly(defaultScheduleProfile.paymentScheduleCycleStartDate),
          },
          summerWindowCleaning: payload.summerWindowCleaning ?? false,
          windowCleaningMode: windowCleaning?.windowCleaningMode ?? null,
          windowCleaningSeasons: windowCleaning?.windowCleaningSeasons ?? [],
          engineeringRequired: payload.engineeringRequired ?? false,
          winterTractorMode: payload.winterTractorMode ?? 'none',
          instructionSteps: (payload.instructionSteps ?? []).map((step) => step.trim()).filter(Boolean),
          paymentType: initialSeason === 'summer'
            ? payload.summerPaymentType ?? payload.paymentType ?? 'daily'
            : initialSeason === 'winter'
              ? payload.winterPaymentType ?? payload.paymentType ?? 'daily'
              : payload.paymentType ?? ((payload.monthlySalary ?? 0) > 0 ? 'monthly' : 'daily'),
          dailyRate: initialSeason === 'summer'
            ? payload.summerDailyRate ?? payload.dailyRate ?? 0
            : initialSeason === 'winter'
              ? payload.winterDailyRate ?? payload.dailyRate ?? 0
              : payload.dailyRate ?? 0,
          monthlySalary: initialSeason === 'summer'
            ? payload.summerMonthlySalary ?? payload.monthlySalary ?? 0
            : initialSeason === 'winter'
              ? payload.winterMonthlySalary ?? payload.monthlySalary ?? 0
              : payload.monthlySalary ?? 0,
          paymentScheduleCode: activeScheduleProfile.paymentScheduleCode,
          paymentScheduleWeekdays: activeScheduleProfile.paymentScheduleWeekdays,
          paymentScheduleCycleStartDate: activeScheduleProfile.paymentScheduleCycleStartDate,
          summerPaymentType: payload.summerPaymentType ?? payload.paymentType ?? 'daily',
          summerDailyRate: payload.summerDailyRate ?? payload.dailyRate ?? 0,
          summerMonthlySalary: payload.summerMonthlySalary ?? payload.monthlySalary ?? 0,
          summerScheduleCode: payload.summerScheduleCode !== undefined ? payload.summerScheduleCode : payload.paymentScheduleCode ?? null,
          summerScheduleWeekdays: payload.summerScheduleWeekdays ?? payload.paymentScheduleWeekdays ?? [],
          summerScheduleCycleStartDate: payload.summerScheduleCycleStartDate !== undefined ? parseDateOnly(payload.summerScheduleCycleStartDate) : parseDateOnly(payload.paymentScheduleCycleStartDate),
          winterPaymentType: payload.winterPaymentType ?? payload.paymentType ?? 'daily',
          winterDailyRate: payload.winterDailyRate ?? payload.dailyRate ?? 0,
          winterMonthlySalary: payload.winterMonthlySalary ?? payload.monthlySalary ?? 0,
          winterScheduleCode: payload.winterScheduleCode !== undefined ? payload.winterScheduleCode : payload.paymentScheduleCode ?? null,
          winterScheduleWeekdays: payload.winterScheduleWeekdays ?? payload.paymentScheduleWeekdays ?? [],
          winterScheduleCycleStartDate: payload.winterScheduleCycleStartDate !== undefined ? parseDateOnly(payload.winterScheduleCycleStartDate) : parseDateOnly(payload.paymentScheduleCycleStartDate),
          notes: payload.notes ?? null,
          counterpartyId: payload.counterpartyId ?? null,
          createdByUserId: currentUser.id,
        },
      });

      const initialAssignmentContext = {
        resourceType: 'object', resourceId: object.id,
        ownerUserId: object.createdByUserId,
        assignedUserIds: [responsibleUser.id, ...managerUserIds],
      };
      // Initial assignments have a create-time baseline, but explicit denies
      // still apply to the generated object's actual owner and assignments.
      if (responsibleUser.id !== currentUser.id &&
          !decideAccess(currentUser, 'objects.responsibles.manage', true, initialAssignmentContext)) {
        throw new ForbiddenException('Initial object responsible denied');
      }
      if (managerUserIds.length > 0 &&
          !decideAccess(currentUser, 'objects.managers.manage', true, initialAssignmentContext)) {
        throw new ForbiddenException('Initial object managers denied');
      }

      // This endpoint returns a card, not a write-only receipt. A create grant
      // must not bypass a read/section deny through the generated resource ID.
      if (!decideAccess(currentUser, 'objects.read', true, initialAssignmentContext)) {
        throw new ForbiddenException('Created object access denied');
      }

      if (object.counterpartyId) {
        await this.auditService.writeAuditEvent(
          {
            entityType: 'counterparty',
            entityId: object.counterpartyId,
            actorUserId: currentUser.id,
            action: 'counterparty.object_linked',
            newValues: { objectId: object.id },
          },
          tx,
        );
      }

      await tx.objectAssignment.create({
        data: {
          objectId: object.id,
          userId: responsibleUser.id,
          assignmentRoleCode: 'responsible',
          isActive: true,
        },
      });

      for (const manager of managerUsers) {
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId: object.id,
              userId: manager.id,
              assignmentRoleCode: 'manager',
            },
          },
          update: {
            isActive: true,
          },
          create: {
            objectId: object.id,
            userId: manager.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        });
      }

      if (planning) {
        await tx.objectPlanningSettings.create({ data: {
          objectId: object.id,
          automaticSeasons: planning.automaticSeasons,
          summerStartsOn: planning.summerStartsOn ?? null,
          winterStartsOn: planning.winterStartsOn ?? null,
        } });
      }
      await this.objectSetup.createInTransaction(tx, currentUser, object.id, payload.setup);
      const initialContours = payload.payContours?.length
        ? await this.scheduling.createContoursInTransaction(tx, currentUser, object.id, payload.payContours)
        : [];
      const contourIds = new Map<string, string>(initialContours.map((contour) => [contour.code, contour.id]));
      if (payload.staffingPositions?.length) {
        const positions = payload.staffingPositions.map((position) => ({
          ...position,
          groups: position.groups.map((group) => ({
            ...group,
            timeRanges: group.timeRanges.map((range) => {
              if (!range.contourId?.startsWith('draft:')) return range;
              const id = contourIds.get(range.contourId.slice(6));
              if (!id) throw new BadRequestException('Условия оплаты позиции не найдены в создаваемом объекте');
              return { ...range, contourId: id };
            }),
          })),
        }));
        await this.scheduling.createPositionsInTransaction(tx, currentUser, object.id, positions);
      }
      if (payload.contacts?.length) {
        await tx.objectContact.createMany({
          data: payload.contacts.map((contact) => ({
            objectId: object.id,
            name: contact.name.trim(),
            position: contact.position?.trim() || null,
            phones: contact.phones ?? [], emails: contact.emails ?? [],
            links: contact.links ?? [], notes: contact.notes?.trim() || null,
          })),
        });
        await tx.objectAuditLog.create({ data: {
          objectId: object.id, actorUserId: currentUser.id,
          actionCode: 'object.contacts.created', payload: { count: payload.contacts.length },
        } });
      }

      const leadershipUserIds = await this.notificationsService.listActiveUserIdsByRoles(
        [...LEADERSHIP_OBJECT_ROLE_CODES],
        tx,
      );
      await this.notificationsService.createForRecipients({
        recipientUserIds: [
          responsibleUser.id,
          ...managerUsers.map((manager) => manager.id),
          ...leadershipUserIds,
        ].filter((userId) => userId !== currentUser.id),
        type: 'object.created',
        title: 'Создан новый объект',
        body: object.name,
        entityType: 'object',
        entityId: object.id,
        targetUrl: `/objects/${encodeURIComponent(object.id)}`,
        dedupeKey: `object:${object.id}:created`,
      }, tx);

      await this.auditService.writeObjectAuditLog({
        objectId: object.id,
        actorUserId: currentUser.id,
        actionCode: 'object.created',
        payload: {
          name: object.name,
          internalName: object.internalName,
          address: object.address,
          status: object.status,
          seasonMode: object.seasonMode,
          summerWindowCleaning: object.summerWindowCleaning,
          windowCleaningMode: object.windowCleaningMode,
          windowCleaningSeasons: object.windowCleaningSeasons,
          engineeringRequired: object.engineeringRequired,
          winterTractorMode: object.winterTractorMode,
          instructionSteps: object.instructionSteps,
          paymentType: object.paymentType,
          dailyRate: object.dailyRate,
          monthlySalary: object.monthlySalary,
          summerPaymentType: object.summerPaymentType,
          summerDailyRate: object.summerDailyRate,
          summerMonthlySalary: object.summerMonthlySalary,
          winterPaymentType: object.winterPaymentType,
          winterDailyRate: object.winterDailyRate,
          winterMonthlySalary: object.winterMonthlySalary,
          counterpartyId: object.counterpartyId,
          managerUserIds,
          responsibleUserId: responsibleUser.id,
        } as Prisma.InputJsonObject,
      }, tx);

      return tx.object.findUniqueOrThrow({
        where: { id: object.id },
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              user: true,
            },
          },
          counterparty: {
            select: { id: true, name: true, legalName: true, status: true },
          },
        },
      });
    });



    // The object, assignments, audit and notifications are already committed.
    // A chat publication fault must not invite the caller to create it again.
    for (const roomCode of ['objects', 'leadership'] as const) {
      try {
        await this.chatsService.createSystemMessage(roomCode, `Создан объект: ${created.name}`,
          { objectId: created.id, status: created.status }, currentUser.id,
          `object-created:${created.id}:${roomCode}`);
      } catch (error) {
        this.logger.error(`Committed object ${created.id}: chat publication failed in ${roomCode}`,
          error instanceof Error ? error.stack : undefined);
      }
    }

    return this.projectCommittedObjectResult(currentUser, created.id, (object) => object);
  }

  async updateObject(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateObjectDto,
  ): Promise<ObjectResponseDto | SavedWithoutAccess> {
    const roleCodes = this.getRoleCodes(currentUser);
    const instructionsOnly = payload.instructionSteps !== undefined &&
      Object.entries(payload).every(([field, value]) => value === undefined || field === 'instructionSteps');
    const isCoreEditor = await this.canObjectAction(currentUser, id, 'objects.update', canEditObject(roleCodes), 'edit');
    const isRateOnlyEditor = !isCoreEditor && await this.canObjectAction(currentUser, id, 'objects.rates.manage', canEditObjectDailyRate(roleCodes));
    const existing = instructionsOnly
      ? await this.getEditableObject(currentUser, id, 'objects.materials.manage')
      : isRateOnlyEditor
        ? await this.getRateEditableObject(currentUser, id)
        : await this.getEditableObject(currentUser, id);
    if (payload.instructionSteps !== undefined && !await this.canObjectAction(currentUser, id, 'objects.materials.manage', canEditObject(roleCodes), 'edit')) throw new ForbiddenException('Object instructions edit denied');
    if (Object.entries(payload).some(([field, value]) => value !== undefined && OBJECT_COMPENSATION_UPDATE_FIELDS.has(field)) && await this.prisma.objectCompensationVersion.findFirst({where: {objectId: id, scope: 'defaults', cancelledAt: null}})) throw new ConflictException({code: 'DATED_TERMS_REQUIRED', message: 'Ставки и график этого объекта изменяются через датированные условия оплаты'});
    if (
      isRateOnlyEditor && !instructionsOnly &&
      Object.entries(payload).some(
        ([field, value]) => value !== undefined && !OBJECT_COMPENSATION_UPDATE_FIELDS.has(field),
      )
    ) {
      throw new ForbiddenException('This role may only edit object compensation profiles');
    }
    const policy = await this.prisma.objectPlanningSettings.findUnique({ where: { objectId: id } });
    const nextSeasonMode = !instructionsOnly && policy?.automaticSeasons && policy.summerStartsOn && policy.winterStartsOn
      ? annualSeason(policy.summerStartsOn, policy.winterStartsOn)
      : payload.seasonMode !== undefined ? payload.seasonMode : existing.seasonMode;
    const existingBase = baseCompensation(existing);
    if (policy?.automaticSeasons && payload.seasonMode !== undefined && payload.seasonMode !== nextSeasonMode) {
      throw new BadRequestException('Для ручного выбора сезона сначала отключите автоматическое переключение в разделе «Бюджет и сезоны».');
    }
    const nextSummerPaymentType = payload.summerPaymentType ?? existing.summerPaymentType;
    const nextSummerDailyRate = payload.summerDailyRate ?? existing.summerDailyRate;
    const nextSummerMonthlySalary = payload.summerMonthlySalary ?? existing.summerMonthlySalary;
    const nextWinterPaymentType = payload.winterPaymentType ?? existing.winterPaymentType;
    const nextWinterDailyRate = payload.winterDailyRate ?? existing.winterDailyRate;
    const nextWinterMonthlySalary = payload.winterMonthlySalary ?? existing.winterMonthlySalary;
    const defaultScheduleProfile = {
      paymentScheduleCode: payload.paymentScheduleCode !== undefined
        ? payload.paymentScheduleCode
        : existingBase.paymentScheduleCode,
      paymentScheduleWeekdays: payload.paymentScheduleWeekdays ?? existingBase.paymentScheduleWeekdays,
      paymentScheduleCycleStartDate: payload.paymentScheduleCycleStartDate !== undefined
        ? parseDateOnly(payload.paymentScheduleCycleStartDate)
        : existingBase.paymentScheduleCycleStartDate,
    };
    const summerScheduleProfile = {
      paymentScheduleCode: payload.summerScheduleCode !== undefined
        ? payload.summerScheduleCode
        : existing.summerScheduleCode,
      paymentScheduleWeekdays: payload.summerScheduleWeekdays ?? existing.summerScheduleWeekdays,
      paymentScheduleCycleStartDate: payload.summerScheduleCycleStartDate !== undefined
        ? parseDateOnly(payload.summerScheduleCycleStartDate)
        : existing.summerScheduleCycleStartDate,
    };
    const winterScheduleProfile = {
      paymentScheduleCode: payload.winterScheduleCode !== undefined
        ? payload.winterScheduleCode
        : existing.winterScheduleCode,
      paymentScheduleWeekdays: payload.winterScheduleWeekdays ?? existing.winterScheduleWeekdays,
      paymentScheduleCycleStartDate: payload.winterScheduleCycleStartDate !== undefined
        ? parseDateOnly(payload.winterScheduleCycleStartDate)
        : existing.winterScheduleCycleStartDate,
    };
    for (const [label, profile] of [
      ['Базовый график', defaultScheduleProfile],
      ['Летний график', summerScheduleProfile],
      ['Зимний график', winterScheduleProfile],
    ] as const) {
      const error = getScheduleConfigurationError({
        scheduleCode: profile.paymentScheduleCode,
        scheduleWeekdays: profile.paymentScheduleWeekdays,
        scheduleCycleStartDate: profile.paymentScheduleCycleStartDate,
      });
      if (error) throw new BadRequestException(`${label}: ${error}`);
    }
    const activeScheduleProfile = resolveActiveScheduleProfile(
      nextSeasonMode,
      defaultScheduleProfile,
      summerScheduleProfile,
      winterScheduleProfile,
    );
    const rateFieldsSubmitted = payload.paymentType !== undefined || typeof payload.dailyRate === 'number' || typeof payload.monthlySalary === 'number' || payload.paymentScheduleCode !== undefined || payload.paymentScheduleWeekdays !== undefined || payload.paymentScheduleCycleStartDate !== undefined ||
      payload.summerPaymentType !== undefined || payload.summerDailyRate !== undefined || payload.summerMonthlySalary !== undefined || payload.summerScheduleCode !== undefined || payload.summerScheduleWeekdays !== undefined || payload.summerScheduleCycleStartDate !== undefined ||
      payload.winterPaymentType !== undefined || payload.winterDailyRate !== undefined || payload.winterMonthlySalary !== undefined || payload.winterScheduleCode !== undefined || payload.winterScheduleWeekdays !== undefined || payload.winterScheduleCycleStartDate !== undefined;
    const canWriteRates = !instructionsOnly && await this.canObjectAction(currentUser, id, 'objects.rates.manage', canEditObjectDailyRate(roleCodes));
    const seasonModeChanged = nextSeasonMode !== existing.seasonMode;
    const shouldActivateRateProfile = canWriteRates && (rateFieldsSubmitted || seasonModeChanged);
    const activeSeasonRates = nextSeasonMode === 'summer'
      ? { paymentType: nextSummerPaymentType, dailyRate: nextSummerDailyRate, monthlySalary: nextSummerMonthlySalary }
      : nextSeasonMode === 'winter'
        ? { paymentType: nextWinterPaymentType, dailyRate: nextWinterDailyRate, monthlySalary: nextWinterMonthlySalary }
        : { paymentType: payload.paymentType ?? existingBase.paymentType, dailyRate: payload.dailyRate ?? existingBase.dailyRate, monthlySalary: payload.monthlySalary ?? existingBase.monthlySalary };

    if (
      rateFieldsSubmitted &&
      !canWriteRates
    ) {
      throw new ForbiddenException('Object salary editing denied');
    }

    if (
      payload.status !== undefined &&
      payload.status !== existing.status
    ) {
      throw new BadRequestException(
        'Object status change must go through approval request flow',
      );
    }

    if (
      payload.counterpartyId !== undefined &&
      payload.counterpartyId !== existing.counterpartyId
    ) {
      if (existing.counterpartyId) {
        // Replacing A with B also unlinks A and requires authority over A.
        this.assertCounterpartyLinkAuthority(currentUser, existing.counterpartyId);
      }
      if (payload.counterpartyId) {
        await this.assertCounterpartyCanBeLinked(
          currentUser,
          payload.counterpartyId,
        );
      }
    }

    const currentResponsible = existing.assignments.find(
      (assignment) => assignment.assignmentRoleCode === 'responsible',
    );
    const selectedResponsible = payload.responsibleUserId
      ? await this.getAssignableResponsibleUser(payload.responsibleUserId)
      : null;

    if (!selectedResponsible && !currentResponsible) {
      throw new BadRequestException('Object responsible is required');
    }

    const changes: ObjectUpdateChangeSet = {};

    if (payload.name !== undefined && payload.name !== existing.name) {
      changes.name = {
        oldValue: existing.name,
        newValue: payload.name,
      };
    }

    if (
      payload.internalName !== undefined &&
      payload.internalName !== existing.internalName
    ) {
      changes.internalName = {
        oldValue: existing.internalName,
        newValue: payload.internalName,
      };
    }

    if (payload.address !== undefined && payload.address !== existing.address) {
      changes.address = {
        oldValue: existing.address,
        newValue: payload.address,
      };
    }

    if (
      payload.seasonMode !== undefined &&
      payload.seasonMode !== existing.seasonMode
    ) {
      changes.seasonMode = {
        oldValue: existing.seasonMode,
        newValue: payload.seasonMode,
      };
    }

    const normalizedInstructionSteps = payload.instructionSteps?.map((step) => step.trim()).filter(Boolean);
    const windowCleaning = resolveWindowCleaningChange(payload, existing);
    if (windowCleaning && (windowCleaning.windowCleaningMode !== existing.windowCleaningMode ||
      JSON.stringify(windowCleaning.windowCleaningSeasons) !== JSON.stringify(existing.windowCleaningSeasons))) {
      changes.windowCleaningMode = { oldValue: existing.windowCleaningMode, newValue: windowCleaning.windowCleaningMode };
      changes.windowCleaningSeasons = { oldValue: existing.windowCleaningSeasons, newValue: windowCleaning.windowCleaningSeasons };
    }
    if (payload.summerWindowCleaning !== undefined && payload.summerWindowCleaning !== existing.summerWindowCleaning) {
      changes.summerWindowCleaning = { oldValue: existing.summerWindowCleaning, newValue: payload.summerWindowCleaning };
    }
    if (payload.engineeringRequired !== undefined && payload.engineeringRequired !== existing.engineeringRequired) {
      changes.engineeringRequired = { oldValue: existing.engineeringRequired, newValue: payload.engineeringRequired };
    }
    if (payload.winterTractorMode !== undefined && payload.winterTractorMode !== existing.winterTractorMode) {
      changes.winterTractorMode = { oldValue: existing.winterTractorMode, newValue: payload.winterTractorMode };
    }
    if (normalizedInstructionSteps && JSON.stringify(normalizedInstructionSteps) !== JSON.stringify(existing.instructionSteps)) {
      changes.instructionSteps = { oldValue: existing.instructionSteps, newValue: normalizedInstructionSteps };
    }

    if (payload.notes !== undefined && payload.notes !== existing.notes) {
      changes.notes = {
        oldValue: existing.notes,
        newValue: payload.notes,
      };
    }

    if (
      payload.counterpartyId !== undefined &&
      payload.counterpartyId !== existing.counterpartyId
    ) {
      changes.counterpartyId = {
        oldValue: existing.counterpartyId,
        newValue: payload.counterpartyId,
      };
    }

    if (
      payload.paymentType !== undefined &&
      payload.paymentType !== existing.paymentType
    ) {
      changes.paymentType = {
        oldValue: existing.paymentType,
        newValue: payload.paymentType,
      };
    }

    if (
      payload.dailyRate !== undefined &&
      payload.dailyRate !== existing.dailyRate
    ) {
      changes.dailyRate = {
        oldValue: existing.dailyRate,
        newValue: payload.dailyRate,
      };
    }

    if (
      payload.monthlySalary !== undefined &&
      payload.monthlySalary !== existing.monthlySalary
    ) {
      changes.monthlySalary = {
        oldValue: existing.monthlySalary,
        newValue: payload.monthlySalary,
      };
    }

    for (const field of ['summerPaymentType', 'summerDailyRate', 'summerMonthlySalary', 'winterPaymentType', 'winterDailyRate', 'winterMonthlySalary'] as const) {
      const nextValue = payload[field];
      if (nextValue !== undefined && nextValue !== existing[field]) {
        changes[field] = { oldValue: existing[field], newValue: nextValue };
      }
    }

    if (
      selectedResponsible &&
      selectedResponsible.id !== currentResponsible?.user.id
    ) {
      changes.responsibleUserId = {
        oldValue: currentResponsible?.user.id ?? null,
        newValue: selectedResponsible.id,
      };
    }

    const updated = (await this.runObjectSourceWrite(currentUser, id, instructionsOnly ? 'objects.materials.manage' : isRateOnlyEditor ? 'objects.rates.manage' : 'objects.update', isRateOnlyEditor ? canEditObjectDailyRate(roleCodes) : canEditObject(roleCodes) || (existing.status === 'frozen' && canOverrideFrozenObject(roleCodes)), isRateOnlyEditor ? undefined : 'edit', async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, currentUser);
      const locked = await tx.object.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
      const currentPolicy = await tx.objectPlanningSettings.findUnique({ where: { objectId: id } });
      if (locked.updatedAt.getTime() !== existing.updatedAt.getTime() || (currentPolicy?.version ?? 0) !== (policy?.version ?? 0)) {
        throw new ConflictException('Объект или настройки сезонов изменены. Обновите данные перед сохранением.');
      }
      await tx.object.update({
        where: { id },
        data: {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.internalName !== undefined
            ? { internalName: payload.internalName }
            : {}),
          ...(payload.address !== undefined ? { address: payload.address } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          ...(!instructionsOnly && (payload.seasonMode !== undefined || policy?.automaticSeasons)
            ? { seasonMode: nextSeasonMode }
            : {}),
          ...(canWriteRates && (rateFieldsSubmitted || !existing.baseCompensationProfile) ? { baseCompensationProfile: {
            paymentType: payload.paymentType ?? existingBase.paymentType,
            dailyRate: payload.dailyRate ?? existingBase.dailyRate,
            monthlySalary: payload.monthlySalary ?? existingBase.monthlySalary,
            ...defaultScheduleProfile, paymentScheduleCycleStartDate: formatDateOnly(defaultScheduleProfile.paymentScheduleCycleStartDate),
          } } : {}),
          ...(payload.summerWindowCleaning !== undefined ? { summerWindowCleaning: payload.summerWindowCleaning } : {}),
          ...(windowCleaning ?? {}),
          ...(payload.engineeringRequired !== undefined ? { engineeringRequired: payload.engineeringRequired } : {}),
          ...(payload.winterTractorMode !== undefined ? { winterTractorMode: payload.winterTractorMode } : {}),
          ...(normalizedInstructionSteps !== undefined ? { instructionSteps: normalizedInstructionSteps } : {}),
          ...(payload.paymentType !== undefined
            ? { paymentType: payload.paymentType }
            : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
          ...(payload.counterpartyId !== undefined
            ? { counterpartyId: payload.counterpartyId }
            : {}),
          ...(payload.counterpartyId !== undefined && payload.counterpartyId !== existing.counterpartyId && existing.masterForCounterpartyId
            ? { masterForCounterpartyId: null }
            : {}),
          ...(payload.dailyRate !== undefined
            ? { dailyRate: payload.dailyRate }
            : {}),
          ...(payload.monthlySalary !== undefined
            ? { monthlySalary: payload.monthlySalary }
            : {}),
          ...(shouldActivateRateProfile && activeSeasonRates ? activeSeasonRates : {}),
          ...(payload.summerPaymentType !== undefined ? { summerPaymentType: payload.summerPaymentType } : {}),
          ...(payload.summerDailyRate !== undefined ? { summerDailyRate: payload.summerDailyRate } : {}),
          ...(payload.summerMonthlySalary !== undefined ? { summerMonthlySalary: payload.summerMonthlySalary } : {}),
          ...(shouldActivateRateProfile ? activeScheduleProfile : {}),
          ...(payload.summerScheduleCode !== undefined ? { summerScheduleCode: payload.summerScheduleCode } : {}),
          ...(payload.summerScheduleWeekdays !== undefined ? { summerScheduleWeekdays: payload.summerScheduleWeekdays } : {}),
          ...(payload.summerScheduleCycleStartDate !== undefined ? { summerScheduleCycleStartDate: parseDateOnly(payload.summerScheduleCycleStartDate) } : {}),
          ...(payload.winterPaymentType !== undefined ? { winterPaymentType: payload.winterPaymentType } : {}),
          ...(payload.winterDailyRate !== undefined ? { winterDailyRate: payload.winterDailyRate } : {}),
          ...(payload.winterMonthlySalary !== undefined ? { winterMonthlySalary: payload.winterMonthlySalary } : {}),
          ...(payload.winterScheduleCode !== undefined ? { winterScheduleCode: payload.winterScheduleCode } : {}),
          ...(payload.winterScheduleWeekdays !== undefined ? { winterScheduleWeekdays: payload.winterScheduleWeekdays } : {}),
          ...(payload.winterScheduleCycleStartDate !== undefined ? { winterScheduleCycleStartDate: parseDateOnly(payload.winterScheduleCycleStartDate) } : {}),
        },
      });

      if (
        payload.counterpartyId !== undefined &&
        payload.counterpartyId !== existing.counterpartyId
      ) {
        if (existing.masterForCounterpartyId) {
          await this.auditService.writeAuditEvent(
            {
              entityType: 'counterparty',
              entityId: existing.masterForCounterpartyId,
              actorUserId: currentUser.id,
              action: 'counterparty.master_object_cleared',
              oldValues: { objectId: id },
              newValues: { reason: 'object_counterparty_changed' },
            },
            tx,
          );
        }
        if (existing.counterpartyId) {
          await this.auditService.writeAuditEvent(
            {
              entityType: 'counterparty',
              entityId: existing.counterpartyId,
              actorUserId: currentUser.id,
              action: payload.counterpartyId
                ? 'counterparty.object_unlinked_by_relink'
                : 'counterparty.object_unlinked',
              oldValues: { objectId: id },
              newValues: payload.counterpartyId
                ? { newCounterpartyId: payload.counterpartyId }
                : { objectId: null },
            },
            tx,
          );
        }
        if (payload.counterpartyId) {
          await this.auditService.writeAuditEvent(
            {
              entityType: 'counterparty',
              entityId: payload.counterpartyId,
              actorUserId: currentUser.id,
              action: 'counterparty.object_linked',
              oldValues: existing.counterpartyId
                ? { previousCounterpartyId: existing.counterpartyId }
                : null,
              newValues: { objectId: id },
            },
            tx,
          );
        }
      }

      if (selectedResponsible) {
        await tx.objectAssignment.updateMany({
          where: {
            objectId: id,
            assignmentRoleCode: 'responsible',
            isActive: true,
            userId: { not: selectedResponsible.id },
          },
          data: { isActive: false },
        });
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId: id,
              userId: selectedResponsible.id,
              assignmentRoleCode: 'responsible',
            },
          },
          update: { isActive: true },
          create: {
            objectId: id,
            userId: selectedResponsible.id,
            assignmentRoleCode: 'responsible',
            isActive: true,
          },
        });
      }

      const updatedObject = await tx.object.findUniqueOrThrow({
        where: { id },
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
          counterparty: {
            select: { id: true, name: true, legalName: true, status: true },
          },
        },
      });

      if (shouldActivateRateProfile) {
        await this.auditService.writeAuditEvent({ entityType: 'object', entityId: id, actorUserId: currentUser.id, action: 'object.compensation.profile_saved', newValues: {
          effectiveOn: moscowDateKey(), seasonMode: nextSeasonMode, baseProfile: updatedObject.baseCompensationProfile,
          paymentType: updatedObject.paymentType, dailyRate: updatedObject.dailyRate, monthlySalary: updatedObject.monthlySalary,
          summerDailyRate: updatedObject.summerDailyRate, summerMonthlySalary: updatedObject.summerMonthlySalary,
          winterDailyRate: updatedObject.winterDailyRate, winterMonthlySalary: updatedObject.winterMonthlySalary,
        } }, tx);
      }
      if (Object.keys(changes).length > 0) {
        await this.auditService.writeObjectAuditLog({
          objectId: id,
          actorUserId: currentUser.id,
          actionCode: 'object.updated',
          payload: this.buildObjectUpdateAuditPayload(changes),
        }, tx);
        const leadershipUserIds = await this.notificationsService.listActiveUserIdsByRoles(
          [...LEADERSHIP_OBJECT_ROLE_CODES],
          tx,
        );
        await this.notificationsService.createForRecipients({
          recipientUserIds: [
            ...updatedObject.assignments.map((assignment) => assignment.userId),
            ...leadershipUserIds,
          ].filter((userId) => userId !== currentUser.id),
          type: 'object.updated',
          title: 'Изменён объект',
          body: updatedObject.name,
          entityType: 'object',
          entityId: id,
          targetUrl: `/objects/${encodeURIComponent(id)}`,
          dedupeKey: `object:${id}:updated:${updatedObject.updatedAt.toISOString()}`,
        }, tx);
      }

      return updatedObject;
    }).catch((error: unknown) =>
      this.rethrowResponsibleAssignmentError(error),
    )) as ObjectView;

    return projectCommittedWrite(this.prisma, currentUser, async () => {
      const subject = await loadAccessSubject(this.prisma, currentUser.id);
      if (!subject?.isActive) throw new ForbiddenException('Доступ к объекту изменился');
      const actor: CurrentAuthUser = {
        ...currentUser, ...subject, isActive: true, roleCode: subject.roleCodes?.[0] ?? '',
        roleCodes: [...(subject.roleCodes ?? [])], permissionCodes: [...(subject.permissionCodes ?? [])],
      };
      const grants = (await resolveObjectDelegationGrants(this.prisma, actor.id)).filter((grant) => grant.objectId === id);
      return objectDelegationContext.run({ actorUserId: actor.id, grants, used: new Map() }, async () => {
        // Read the committed resource through fresh visibility and projection;
        // never return the protected pre-revoke transaction snapshot.
        return this.getObjectById(actor, updated.id);
      });
    });
  }

  async changeStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ChangeObjectStatusDto,
  ): Promise<ApprovalRequestResponseDto | SavedWithoutAccess> {
    const existing = await this.getObjectById(currentUser, id);

    const statusAction = existing.status === 'archived' ? 'objects.restore'
      : payload.status === 'frozen' ? 'objects.freeze'
        : payload.status === 'archived' ? 'objects.archive' : 'objects.status';
    if (!await this.canObjectAction(currentUser, id, statusAction, canManageObjectResponsibles(this.getRoleCodes(currentUser)), 'status')) {
      throw new ForbiddenException('Object status changing denied');
    }

    if (existing.status === payload.status) {
      throw new BadRequestException('Object already has requested status');
    }
    if (existing.status === 'archived' && payload.status === 'frozen' && !await this.canObjectAction(currentUser, id, 'objects.freeze', canManageObjectResponsibles(this.getRoleCodes(currentUser)), 'status')) throw new ForbiddenException('Object freeze denied');

    const createdRequest = await this.runObjectSourceWrite(currentUser, id, statusAction, canManageObjectResponsibles(this.getRoleCodes(currentUser)), 'status', async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, currentUser);
      const current = await tx.object.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
      if (!current || current.status !== existing.status) {
        throw new ConflictException('Состояние объекта изменилось. Обновите карточку.');
      }
      if (!await this.canObjectAction(currentUser, id, statusAction, canManageObjectResponsibles(this.getRoleCodes(currentUser)), 'status', tx)) {
        throw new ForbiddenException('Object status changing denied');
      }
    const pendingRequest = await tx.approvalRequest.findFirst({
      where: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
        status: 'pending',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        cancelledBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    if (pendingRequest) {
      throw new ConflictException(
        'Object status change approval request is already pending',
      );
    }

    const createdRequest = await tx.approvalRequest.create({
      data: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
        createdByUserId: currentUser.id,
        payloadSnapshot: {
          summaryTitle: 'Изменение объекта',
          summarySubtitle: `${existing.name} · ${existing.status} → ${payload.status}`,
          objectId: id,
          objectName: existing.name,
          currentStatus: existing.status,
          requestedStatus: payload.status,
        },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        cancelledBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId: id,
      actorUserId: currentUser.id,
      actionCode: 'object.status_change_requested',
      payload: {
        oldStatus: existing.status,
        newStatus: payload.status,
        approvalRequestId: createdRequest.id,
      } as Prisma.InputJsonObject,
    }, tx);

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: createdRequest.id,
      actorUserId: currentUser.id,
      action: 'approval.request.created',
      newValues: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
      },
    }, tx);
    return createdRequest;
    });

    return this.projectCommittedObjectResult(currentUser, id, () => this.mapApprovalRequest(createdRequest, currentUser.id));
  }

  async applyObjectStatusChangeApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      objectId: string;
      actorUserId: string;
      expectedCurrentStatus: string;
      nextStatus: string;
    },
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "objects"
      WHERE "id" = ${params.objectId}
      FOR UPDATE
    `;
    const object = await tx.object.findFirst({
      where: {
        id: params.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    if (object.status !== params.expectedCurrentStatus) {
      throw new ConflictException(
        'Object status changed after approval request was created',
      );
    }

    if (params.nextStatus === 'archived') {
      const lifecycleAt = new Date();
      await tx.$queryRaw`
        SELECT "id"
        FROM "object_employee_assignments"
        WHERE "objectId" = ${params.objectId}
          AND "isActive" = true
        FOR UPDATE
      `;
      const activeAssignments = await tx.objectEmployeeAssignment.findMany({
        where: {
          objectId: params.objectId,
          isActive: true,
        },
        select: {
          id: true,
          employeeId: true,
          startDate: true,
        },
      });

      if (activeAssignments.length > 0) {
        const assignmentIds = activeAssignments.map((assignment) => assignment.id);
        const employeeIds = activeAssignments.map(
          (assignment) => assignment.employeeId,
        );
        const closedAssignments = await tx.objectEmployeeAssignment.updateMany({
          where: {
            id: { in: assignmentIds },
            isActive: true,
          },
          data: {
            isActive: false,
            endDate: lifecycleAt,
          },
        });
        if (closedAssignments.count !== activeAssignments.length) {
          throw new ConflictException(
            'Object employee assignments changed concurrently',
          );
        }

        await tx.employeeObjectAssignmentHistory.updateMany({
          where: {
            objectId: params.objectId,
            employeeId: { in: employeeIds },
            endedAt: null,
          },
          data: {
            endedAt: lifecycleAt,
            closedByUserId: params.actorUserId,
          },
        });

        for (const assignment of activeAssignments) {
          await this.auditService.writeAuditEvent(
            {
              entityType: 'employee',
              entityId: assignment.employeeId,
              actorUserId: params.actorUserId,
              action: 'employee.object_assignment.ended_on_object_archive',
              oldValues: {
                assignmentId: assignment.id,
                objectId: params.objectId,
                isActive: true,
                startDate: assignment.startDate?.toISOString() ?? null,
              },
              newValues: {
                isActive: false,
                endedAt: lifecycleAt.toISOString(),
              },
            },
            tx,
          );
        }
      }
    }

    await tx.object.update({
      where: {
        id: params.objectId,
      },
      data: {
        status: params.nextStatus,
      },
    });
  }

  async assertObjectStatusChangeApprovalStillValid(
    tx: Prisma.TransactionClient,
    params: {
      objectId: string;
    },
  ): Promise<void> {
    const object = await tx.object.findFirst({
      where: {
        id: params.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }
  }

  async addResponsibleToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto | SavedWithoutAccess> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!await this.canObjectAction(currentUser, objectId, 'objects.responsibles.manage', canManageObjectResponsibles(roleCodes), 'assign')) {
      throw new ForbiddenException('Responsible management denied');
    }

    await this.getObjectById(currentUser, objectId);

    const user = await this.getAssignableResponsibleUser(userId);

    await this.runObjectSourceWrite(currentUser, objectId, 'objects.responsibles.manage', canManageObjectResponsibles(roleCodes), 'assign', async (tx) => {
        await this.lockObjectAssignmentAuthority(tx, currentUser, objectId, 'objects.responsibles.manage');

        await tx.objectAssignment.updateMany({
          where: {
            objectId,
            assignmentRoleCode: 'responsible',
            isActive: true,
            userId: { not: user.id },
          },
          data: { isActive: false },
        });
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId,
              userId: user.id,
              assignmentRoleCode: 'responsible',
            },
          },
          update: {
            isActive: true,
          },
          create: {
            objectId,
            userId: user.id,
            assignmentRoleCode: 'responsible',
            isActive: true,
          },
        });
        await this.auditService.writeObjectAuditLog({
          objectId,
          actorUserId: currentUser.id,
          actionCode: 'object.responsible_added',
          payload: { userId: user.id, login: user.login, fullName: user.fullName },
        }, tx);
      })
      .catch((error: unknown) =>
        this.rethrowResponsibleAssignmentError(error),
      );

    return this.projectCommittedObjectResult(currentUser, objectId, (object) => object);
  }

  async removeResponsibleFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!await this.canObjectAction(currentUser, objectId, 'objects.responsibles.manage', canManageObjectResponsibles(roleCodes), 'assign')) {
      throw new ForbiddenException('Responsible management denied');
    }

    const object = await this.getObjectById(currentUser, objectId);
    const activeResponsibles = object.responsibles;

    if (activeResponsibles.length <= 1) {
      throw new ForbiddenException(
        'У объекта должен остаться хотя бы один ответственный.',
      );
    }

    await this.prisma.objectAssignment.updateMany({
      where: {
        objectId,
        userId,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.responsible_removed',
      payload: {
        userId,
      } as Prisma.InputJsonObject,
    });

    return this.getObjectById(currentUser, objectId);
  }

  async addManagerToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto | SavedWithoutAccess> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!await this.canObjectAction(currentUser, objectId, 'objects.managers.manage', canManageObjectResponsibles(roleCodes), 'assign')) {
      throw new ForbiddenException('Manager management denied');
    }

    await this.getObjectById(currentUser, objectId);

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Selected user not found');
    }

    const targetRoleCodes = user.roles.map((item) => item.role.code);

    if (!canBeObjectManager(targetRoleCodes)) {
      throw new ForbiddenException('Selected user cannot be object manager');
    }

    await this.runObjectSourceWrite(currentUser, objectId, 'objects.managers.manage', canManageObjectResponsibles(roleCodes), 'assign', async (tx) => {
    await this.lockObjectAssignmentAuthority(tx, currentUser, objectId, 'objects.managers.manage');
    await tx.objectAssignment.upsert({
      where: {
        objectId_userId_assignmentRoleCode: {
          objectId,
          userId,
          assignmentRoleCode: 'manager',
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.manager_added',
      payload: {
        userId: user.id,
        login: user.login,
        fullName: user.fullName,
      } as Prisma.InputJsonObject,
    }, tx);
    });

    return this.projectCommittedObjectResult(currentUser, objectId, (object) => object);
  }

  async removeManagerFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto | SavedWithoutAccess> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!await this.canObjectAction(currentUser, objectId, 'objects.managers.manage', canManageObjectResponsibles(roleCodes), 'assign')) {
      throw new ForbiddenException('Manager management denied');
    }

    await this.getObjectById(currentUser, objectId);

    await this.runObjectSourceWrite(currentUser, objectId, 'objects.managers.manage', canManageObjectResponsibles(roleCodes), 'assign', async (tx) => {
    await this.lockObjectAssignmentAuthority(tx, currentUser, objectId, 'objects.managers.manage');
    await tx.objectAssignment.updateMany({
      where: {
        objectId,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.manager_removed',
      payload: {
        userId,
      } as Prisma.InputJsonObject,
    }, tx);
    });

    return this.projectCommittedObjectResult(currentUser, objectId, (object) => object);
  }

  async runObjectSourceWrite<T>(
    user: CurrentAuthUser,
    objectId: string,
    actionCode: string,
    legacy: boolean,
    delegatedAction: ObjectDelegatedAction | undefined,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const outer = objectDelegationContext.getStore();
    const original = outer?.actorUserId === user.id ? outer.grants.filter((grant) => grant.objectId === objectId) : [];
    const sourceIds = [...new Set(original.map((grant) => grant.substitutionId))].sort();
    const principalIds = [...new Set(original.map((grant) => grant.principalUserId))].sort();
    const used = new Map<string, ObjectDelegationGrant>();
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      await lockActorAccessRevision(tx, user);
      if (principalIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" IN (${Prisma.join(principalIds)}) ORDER BY "id" FOR SHARE`);
      if (sourceIds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitutions" WHERE "id" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitution_objects" WHERE "objectId" = ${objectId} AND "substitutionId" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
      }
      await tx.$queryRaw`SELECT "id" FROM "object_assignments" WHERE "objectId" = ${objectId} AND "isActive" = true ORDER BY "id" FOR SHARE`;
      const grants = sourceIds.length
        ? (await resolveObjectDelegationGrants(tx, user.id)).filter((grant) => grant.objectId === objectId && sourceIds.includes(grant.substitutionId)) : [];
      return objectDelegationContext.run({ actorUserId: user.id, grants, used }, async () => {
        const visible = await tx.object.findFirst({ where: { id: objectId, deletedAt: null, ...(await this.buildVisibilityWhere(user)) }, select: { id: true } });
        if (!visible || !await this.canObjectAction(user, objectId, actionCode, legacy, delegatedAction, tx)) {
          throw new ForbiddenException('Доступ к объекту изменился. Изменения не сохранены.');
        }
        return write(tx);
      });
    });
    if (outer?.actorUserId === user.id) {
      for (const [key, grant] of outer.used) if (grant.objectId === objectId) outer.used.delete(key);
      for (const [key, grant] of used) outer.used.set(key, grant);
    }
    return saved;
  }

  projectCommittedObjectResult<T>(
    currentUser: CurrentAuthUser,
    objectId: string,
    project: (object: ObjectResponseDto) => T | Promise<T>,
  ): Promise<T | SavedWithoutAccess> {
    return projectCommittedWrite(this.prisma, currentUser, async () => {
      const subject = await loadAccessSubject(this.prisma, currentUser.id);
      if (!subject?.isActive) throw new ForbiddenException('Доступ к объекту изменился');
      const actor: CurrentAuthUser = {
        ...currentUser, ...subject, isActive: true, roleCode: subject.roleCodes?.[0] ?? '',
        roleCodes: [...(subject.roleCodes ?? [])], permissionCodes: [...(subject.permissionCodes ?? [])],
      };
      const grants = (await resolveObjectDelegationGrants(this.prisma, actor.id)).filter((grant) => grant.objectId === objectId);
      return objectDelegationContext.run({ actorUserId: actor.id, grants, used: new Map() }, async () => {
        const object = await this.getObjectById(actor, objectId);
        return project(object);
      });
    });
  }

  private async lockObjectAssignmentAuthority(
    tx: Prisma.TransactionClient,
    currentUser: CurrentAuthUser,
    objectId: string,
    actionCode: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
    await lockActorAccessRevision(tx, currentUser);
    if (!await this.canObjectAction(currentUser, objectId, actionCode, canManageObjectResponsibles(this.getRoleCodes(currentUser)), 'assign', tx)) {
      throw new ForbiddenException('Object assignment management denied');
    }
  }

  private buildObjectUpdateAuditPayload(
    changes: ObjectUpdateChangeSet,
  ): Prisma.InputJsonObject {
    const normalizedChanges = Object.fromEntries(
      Object.entries(changes).map(([field, value]) => [
        field,
        {
          oldValue: value.oldValue,
          newValue: value.newValue,
        },
      ]),
    );

    return {
      changes: normalizedChanges,
    } as Prisma.InputJsonObject;
  }

  private async getAssignableResponsibleUser(userId: string): Promise<{
    id: string;
    login: string;
    fullName: string;
  }> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Selected responsible is not available');
    }

    return user;
  }

  private async getEditableObject(
    currentUser: CurrentAuthUser,
    id: string,
    actionCode = 'objects.update',
  ): Promise<ObjectView> {
    const roleCodes = this.getRoleCodes(currentUser);

    const existing = (await this.prisma.object.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
    })) as ObjectView | null;

    if (!existing) {
      throw new NotFoundException('Object not found');
    }

    const allowedToEdit =
      canEditObject(roleCodes) ||
      (existing.status === 'frozen' && canOverrideFrozenObject(roleCodes));

    if (!await this.canObjectAction(currentUser, id, actionCode, allowedToEdit, 'edit')) {
      throw new ForbiddenException('Object editing denied');
    }

    return existing;
  }

  private async getRateEditableObject(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectView> {
    if (!await this.canObjectAction(currentUser, id, 'objects.rates.manage', canEditObjectDailyRate(this.getRoleCodes(currentUser)))) {
      throw new ForbiddenException('Object compensation editing denied');
    }
    const existing = (await this.prisma.object.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: { user: true },
        },
      },
    })) as ObjectView | null;
    if (!existing) throw new NotFoundException('Object not found');
    return existing;
  }

  private async buildVisibilityWhere(currentUser: CurrentAuthUser) {
    return { AND: [
      { OR: [this.buildOperationalVisibilityWhere(currentUser), buildObjectAccessPolicyWhere(currentUser,
        hasHrObjectView(currentUser.permissionCodes) ? { deletedAt: null } : { id: { in: [] } }, 'objects.view_hr')] },
      buildObjectAccessPolicyWhere(currentUser, {}, 'objects.read'),
    ] };
  }

  private async canObjectAction(user: CurrentAuthUser, id: string, actionCode: string, legacy: boolean, delegatedAction?: ObjectDelegatedAction, database: Pick<Prisma.TransactionClient, 'object'> = this.prisma): Promise<boolean> {
    const object = await database.object.findFirst({ where: { id, deletedAt: null }, select: {
      id: true, createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } },
    } });
    if (!object) return false;
    const context = { resourceType: 'object', resourceId: id, ownerUserId: object.createdByUserId, assignedUserIds: object.assignments.map(a => a.userId) };
    if (decideAccess(user, actionCode, legacy, context)) return true;
    const delegated = delegatedAction ? hasDelegatedObjectAction(user.id, id, delegatedAction, true, actionCode, context) : false;
    return decideAccess(user, actionCode, delegated, context);
  }

  private buildOperationalVisibilityWhere(
    currentUser: CurrentAuthUser,
  ): Prisma.ObjectWhereInput {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideObjectAccess(roleCodes)) {
      return buildObjectAccessPolicyWhere(currentUser, { deletedAt: null });
    }

    return buildObjectAccessPolicyWhere(currentUser, {
      deletedAt: null,
      OR: [
        { id: { in: delegatedObjectIds(currentUser.id, 'view', 'objects.read') } },
        {
          createdByUserId: currentUser.id,
        },
        {
          assignments: {
            some: {
              userId: currentUser.id,
              isActive: true,
            },
          },
        },
      ],
    });
  }

  private getEmployeeAssignmentsInclude() {
    return {
      where: {
        isActive: true,
        employee: { deletedAt: null },
      },
      select: {
        employee: {
          select: {
            id: true,
            fullName: true,
            position: true,
            baseDailyRate: true,
            workScheduleCode: true,
            workScheduleCustom: true,
            workTimeText: true,
          },
        },
      },
      orderBy: { employee: { fullName: 'asc' as const } },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private mapApprovalRequest(
    request: {
      id: string;
      approvalType: string;
      sourceEntityType: string;
      sourceEntityId: string;
      status: string;
      decisionComment: string | null;
      payloadSnapshot: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
      resolvedAt: Date | null;
      cancelledAt: Date | null;
      createdBy: {
        id: string;
        login: string;
        fullName: string;
      };
      resolvedBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
      cancelledBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
    },
    currentUserId: string,
  ): ApprovalRequestResponseDto {
    const payloadSnapshot =
      request.payloadSnapshot &&
      typeof request.payloadSnapshot === 'object' &&
      !Array.isArray(request.payloadSnapshot)
        ? (request.payloadSnapshot as Prisma.JsonObject as Record<string, unknown>)
        : {};

    const summaryTitle =
      typeof payloadSnapshot.summaryTitle === 'string' &&
      payloadSnapshot.summaryTitle.trim()
        ? payloadSnapshot.summaryTitle
        : request.approvalType;
    const summarySubtitle =
      typeof payloadSnapshot.summarySubtitle === 'string' &&
      payloadSnapshot.summarySubtitle.trim()
        ? payloadSnapshot.summarySubtitle
        : null;

    return {
      id: request.id,
      approvalType: request.approvalType,
      sourceEntityType: request.sourceEntityType,
      sourceEntityId: request.sourceEntityId,
      status: request.status,
      decisionComment: request.decisionComment,
      payloadSnapshot,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      createdBy: request.createdBy,
      resolvedBy: request.resolvedBy,
      cancelledBy: request.cancelledBy,
      summary: {
        title: summaryTitle,
        subtitle: summarySubtitle,
      },
      capabilities: {
        canApprove: false,
        canReject: false,
        canCancel:
          request.status === 'pending' && request.createdBy.id === currentUserId,
      },
    };
  }

  private objectAuditEmployeesReadable(user: CurrentAuthUser, value: unknown): boolean {
    if (Array.isArray(value)) return value.every(item => this.objectAuditEmployeesReadable(user, item));
    if (value === null || typeof value !== 'object') return true;
    return Object.entries(value).every(([key, item]) => {
      const ids = ['employeeId', 'replacementEmployeeId', 'substituteEmployeeId'].includes(key)
        ? [item] : key === 'employeeIds' && Array.isArray(item) ? item : [];
      return ids.every(id => typeof id !== 'string' || decideAccess(user, 'employees.view', true, {resourceType: 'employee', resourceId: id})) &&
        this.objectAuditEmployeesReadable(user, item);
    });
  }

  private mapObject(
    item: ObjectView,
    currentUser: CurrentAuthUser,
  ): ObjectResponseDto {
    const mappedAssignments = item.assignments.map((assignment) => ({
      userId: assignment.user.id,
      login: assignment.user.login,
      fullName: assignment.user.fullName,
      roleCode: assignment.assignmentRoleCode,
    }));
    const roleCodes = this.getRoleCodes(currentUser);
    const responsible = mappedAssignments.find(
      (assignment) => assignment.roleCode === 'responsible',
    );
    const capabilities = buildObjectCapabilities({ subject: currentUser,
      objectId: item.id,
      currentUserId: currentUser.id,
      roleCodes,
      permissionCodes: currentUser.permissionCodes ?? [],
      objectStatus: item.status,
      createdByUserId: item.createdByUserId,
      assignments: mappedAssignments,
    });
    const canReadMaterials = decideAccess(currentUser, 'objects.materials.read', true, { resourceType: 'object', resourceId: item.id,
      ownerUserId: item.createdByUserId, assignedUserIds: mappedAssignments.map(a => a.userId) });
    // The object-authorized label remains a legacy baseline, but an explicit
    // counterparty read/access deny must also hide its current nested fields.
    const canReadCounterparty = item.counterparty
      ? decideAccess(currentUser, 'counterparties.read', true, {
          resourceType: 'counterparty', resourceId: item.counterparty.id,
        })
      : false;

    return {
      id: item.id,
      name: item.name,
      internalName: item.internalName,
      address: item.address,
      status: item.status,
      seasonMode: item.seasonMode,
      baseCompensationProfile: capabilities.canViewCompensationRates ? item.baseCompensationProfile : null,
      summerWindowCleaning: item.summerWindowCleaning,
      windowCleaningMode: item.windowCleaningMode ?? null,
      windowCleaningSeasons: item.windowCleaningSeasons ?? [],
      engineeringRequired: item.engineeringRequired,
      winterTractorMode: item.winterTractorMode,
      instructionSteps: canReadMaterials ? item.instructionSteps : [],
      paymentType: capabilities.canViewCompensationRates ? item.paymentType : null,
      dailyRate: capabilities.canViewCompensationRates ? item.dailyRate : null,
      monthlySalary: capabilities.canViewCompensationRates ? item.monthlySalary : null,
      paymentScheduleCode: capabilities.canViewCompensationRates ? item.paymentScheduleCode : null,
      paymentScheduleWeekdays: capabilities.canViewCompensationRates ? item.paymentScheduleWeekdays : [],
      paymentScheduleCycleStartDate: capabilities.canViewCompensationRates ? formatDateOnly(item.paymentScheduleCycleStartDate) : null,
      summerPaymentType: capabilities.canViewCompensationRates ? item.summerPaymentType : null,
      summerDailyRate: capabilities.canViewCompensationRates ? item.summerDailyRate : null,
      summerMonthlySalary: capabilities.canViewCompensationRates ? item.summerMonthlySalary : null,
      summerScheduleCode: capabilities.canViewCompensationRates ? item.summerScheduleCode : null,
      summerScheduleWeekdays: capabilities.canViewCompensationRates ? item.summerScheduleWeekdays : [],
      summerScheduleCycleStartDate: capabilities.canViewCompensationRates ? formatDateOnly(item.summerScheduleCycleStartDate) : null,
      winterPaymentType: capabilities.canViewCompensationRates ? item.winterPaymentType : null,
      winterDailyRate: capabilities.canViewCompensationRates ? item.winterDailyRate : null,
      winterMonthlySalary: capabilities.canViewCompensationRates ? item.winterMonthlySalary : null,
      winterScheduleCode: capabilities.canViewCompensationRates ? item.winterScheduleCode : null,
      winterScheduleWeekdays: capabilities.canViewCompensationRates ? item.winterScheduleWeekdays : [],
      winterScheduleCycleStartDate: capabilities.canViewCompensationRates ? formatDateOnly(item.winterScheduleCycleStartDate) : null,
      notes: item.notes,
      counterpartyAccessRestricted: Boolean(item.counterparty && !canReadCounterparty),
      counterparty: item.counterparty && canReadCounterparty
        ? {
            id: item.counterparty.id,
            name: item.counterparty.name,
            legalName: item.counterparty.legalName,
            status: item.counterparty.status,
            canOpenCounterparty: decideAccess(currentUser, 'counterparties.read',
              canViewCounterparties(currentUser.permissionCodes ?? []), {
                resourceType: 'counterparty', resourceId: item.counterparty.id,
              }),
          }
        : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      managers: mappedAssignments.filter(
        (assignment) => assignment.roleCode === 'manager',
      ),
      responsibles: mappedAssignments.filter(
        (assignment) => assignment.roleCode === 'responsible',
      ),
      responsible: responsible
        ? {
            id: responsible.userId,
            login: responsible.login,
            fullName: responsible.fullName,
          }
        : null,
      employees: (capabilities.canViewEmployees ? item.employeeAssignments ?? [] : []).filter(assignment =>
        decideAccess(currentUser, 'employees.view', true, {resourceType: 'employee', resourceId: assignment.employee.id}),
      ).map((assignment) => ({
        id: assignment.employee.id,
        fullName: assignment.employee.fullName,
        position: assignment.employee.position,
        baseDailyRate: capabilities.canViewCompensationRates ? assignment.employee.baseDailyRate : null,
        workScheduleCode: assignment.employee.workScheduleCode,
        workScheduleCustom: assignment.employee.workScheduleCustom,
        workTimeText: assignment.employee.workTimeText,
      })),
      capabilities: {
          ...capabilities,
          canEditMonthlySalary: capabilities.canManageCompensationRates,
      },
    };
  }

  private assertCounterpartyLinkAuthority(currentUser: CurrentAuthUser, counterpartyId: string): void {
    const context = { resourceType: 'counterparty', resourceId: counterpartyId };
    const canRead = decideAccess(currentUser, 'counterparties.read', canViewCounterparties(currentUser.permissionCodes ?? []), context);
    if (!canRead || !decideAccess(currentUser, 'counterparties.objects.link', canLinkCounterpartyObjects(currentUser.permissionCodes ?? []), context)) {
      throw new ForbiddenException('Недостаточно прав для изменения связи с контрагентом.');
    }
  }

  private async assertCounterpartyCanBeLinked(
    currentUser: CurrentAuthUser,
    counterpartyId: string,
  ): Promise<void> {
    this.assertCounterpartyLinkAuthority(currentUser, counterpartyId);
    const counterparty = await this.prisma.counterparty.findFirst({
      where: { id: counterpartyId, status: 'active' },
      select: { id: true },
    });
    if (!counterparty) {
      throw new BadRequestException('Counterparty is not available');
    }
  }

  private rethrowResponsibleAssignmentError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Object already has another active responsible; reload and retry',
      );
    }

    throw error;
  }
}
