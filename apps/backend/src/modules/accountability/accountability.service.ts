import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import { PrismaService } from '../prisma/prisma.service';

import {
  AccountabilityAccountListItemDto,
  AccountabilityAccountSummaryDto,
  AccountabilityAccountViewDto,
  AccountabilityClosureResponseDto,
  AccountabilityExpenseResponseDto,
  AccountabilityFundingResponseDto,
  AccountabilityUserSummaryDto,
} from './dto/accountability-response.dto';
import { CreateAccountabilityFundingDto } from './dto/create-accountability-funding.dto';
import { RejectAccountabilityClosureDto } from './dto/reject-accountability-closure.dto';
import { RejectAccountabilityExpenseDto } from './dto/reject-accountability-expense.dto';
import { SaveAccountabilityExpenseDto } from './dto/save-accountability-expense.dto';
import {
  canApproveAccountabilityClosure,
  canApproveAccountabilityExpense,
  canIssueAccountabilityFunds,
  canReviewAccountability,
  canViewOwnAccountability,
} from './utils/accountability-access.util';
import {
  buildAccountabilityExpenseCapabilities,
} from './utils/accountability-capabilities.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

const EXPENSE_ATTACHMENTS_ENTITY_TYPE = 'accountability_expense';

@Injectable()
export class AccountabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getMyAccount(
    currentUser: CurrentAuthUser,
  ): Promise<AccountabilityAccountViewDto> {
    if (!canViewOwnAccountability()) {
      throw new ForbiddenException('Access to accountability is denied');
    }

    return this.buildAccountView({
      currentUser,
      subjectUserId: currentUser.id,
    });
  }

  async listAccounts(
    currentUser: CurrentAuthUser,
  ): Promise<AccountabilityAccountListItemDto[]> {
    this.assertCanReview(currentUser);

    const accounts = await this.prisma.accountabilityAccount.findMany({
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            roles: {
              select: {
                role: {
                  select: {
                    code: true,
                  },
                },
              },
            },
          },
        },
        fundings: {
          select: {
            amount: true,
          },
        },
        expenses: {
          select: {
            amount: true,
            status: true,
          },
        },
      },
      orderBy: [
        {
          updatedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });

    return accounts.map((account) => ({
      user: this.mapUserSummary(account.user),
      accountId: account.id,
      status: account.status,
      summary: this.buildSummary({
        fundings: account.fundings,
        expenses: account.expenses,
      }),
    }));
  }

  async listUserOptions(
    currentUser: CurrentAuthUser,
  ): Promise<AccountabilityUserSummaryDto[]> {
    this.assertCanReview(currentUser);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
              },
            },
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return users.map((user) => this.mapUserSummary(user));
  }

  async getAccountByUserId(
    currentUser: CurrentAuthUser,
    userId: string,
  ): Promise<AccountabilityAccountViewDto> {
    const isOwnAccount = currentUser.id === userId;

    if (!isOwnAccount) {
      this.assertCanReview(currentUser);
    }

    return this.buildAccountView({
      currentUser,
      subjectUserId: userId,
    });
  }

  async issueFunding(
    currentUser: CurrentAuthUser,
    userId: string,
    payload: CreateAccountabilityFundingDto,
  ): Promise<AccountabilityFundingResponseDto> {
    this.assertCanIssueFunding(currentUser);

    const targetUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Target accountability user not found');
    }

    const amount = new Prisma.Decimal(payload.amount);
    const funding = await this.prisma.$transaction(async (tx) => {
      const existingAccount = await tx.accountabilityAccount.findUnique({
        where: {
          userId,
        },
      });

      let accountId = existingAccount?.id ?? null;

      if (existingAccount?.status === 'closing_requested') {
        throw new ConflictException(
          'Accountability account is locked during closing request',
        );
      }

      if (!existingAccount) {
        const createdAccount = await tx.accountabilityAccount.create({
          data: {
            userId,
            status: 'active',
          },
        });
        accountId = createdAccount.id;
      } else if (existingAccount.status === 'closed') {
        await tx.accountabilityAccount.update({
          where: {
            id: existingAccount.id,
          },
          data: {
            status: 'active',
          },
        });
        accountId = existingAccount.id;
      } else {
        accountId = existingAccount.id;
      }

      const createdFunding = await tx.accountabilityFunding.create({
        data: {
          accountabilityAccountId: accountId,
          amount,
          comment: payload.comment?.trim() || null,
          issuedByUserId: currentUser.id,
        },
        include: {
          issuedBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
              roles: {
                select: {
                  role: {
                    select: {
                      code: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      await this.auditService.writeAuditEvent({
        entityType: 'accountability_funding',
        entityId: createdFunding.id,
        actorUserId: currentUser.id,
        action: 'accountability_funding_issued',
        newValues: {
          accountabilityAccountId: createdFunding.accountabilityAccountId,
          amount: payload.amount,
          issuedByUserId: currentUser.id,
          targetUserId: userId,
        },
      });

      return createdFunding;
    });

    return this.mapFunding(funding);
  }

  async createExpense(
    currentUser: CurrentAuthUser,
    payload: SaveAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    const account = await this.getRequiredOwnActiveAccount(currentUser.id);
    this.assertAccountAllowsOwnExpenseWrite(account.status);
    const description = payload.description.trim();

    if (!description) {
      throw new BadRequestException('Expense description is required');
    }

    const createdExpense = await this.prisma.accountabilityExpense.create({
      data: {
        accountabilityAccountId: account.id,
        amount: new Prisma.Decimal(payload.amount),
        description,
        status: 'draft',
        createdByUserId: currentUser.id,
      },
      include: this.accountabilityExpenseInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_expense',
      entityId: createdExpense.id,
        actorUserId: currentUser.id,
        action: 'accountability_expense_created',
        newValues: {
          amount: payload.amount,
          description,
          status: 'draft',
        },
      });

    const attachmentsByEntityId = await this.loadExpenseAttachments([
      createdExpense.id,
    ]);

    return this.mapExpense({
      expense: createdExpense,
      currentUser,
      attachments: attachmentsByEntityId.get(createdExpense.id) ?? [],
    });
  }

  async updateExpense(
    currentUser: CurrentAuthUser,
    expenseId: string,
    payload: SaveAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    const description = payload.description.trim();

    if (!description) {
      throw new BadRequestException('Expense description is required');
    }

    const existingExpense = await this.prisma.accountabilityExpense.findFirst({
      where: {
        id: expenseId,
      },
      include: {
        accountabilityAccount: {
          select: {
            id: true,
            userId: true,
            status: true,
          },
        },
      },
    });

    if (!existingExpense) {
      throw new NotFoundException('Accountability expense not found');
    }

    if (existingExpense.accountabilityAccount.userId !== currentUser.id) {
      throw new ForbiddenException('Only owner can edit accountability expense');
    }

    if (existingExpense.status !== 'draft') {
      throw new ConflictException('Only draft expense can be edited');
    }

    this.assertAccountAllowsOwnExpenseWrite(
      existingExpense.accountabilityAccount.status,
    );

    const updatedExpense = await this.prisma.accountabilityExpense.update({
      where: {
        id: expenseId,
      },
      data: {
        amount: new Prisma.Decimal(payload.amount),
        description,
      },
      include: this.accountabilityExpenseInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_expense',
      entityId: updatedExpense.id,
        actorUserId: currentUser.id,
        action: 'accountability_expense_updated',
        newValues: {
          amount: payload.amount,
          description,
        },
      });

    const attachmentsByEntityId = await this.loadExpenseAttachments([
      updatedExpense.id,
    ]);

    return this.mapExpense({
      expense: updatedExpense,
      currentUser,
      attachments: attachmentsByEntityId.get(updatedExpense.id) ?? [],
    });
  }

  async submitExpense(
    currentUser: CurrentAuthUser,
    expenseId: string,
  ): Promise<AccountabilityExpenseResponseDto> {
    const existingExpense = await this.prisma.accountabilityExpense.findFirst({
      where: {
        id: expenseId,
      },
      include: {
        accountabilityAccount: {
          select: {
            id: true,
            userId: true,
            status: true,
          },
        },
      },
    });

    if (!existingExpense) {
      throw new NotFoundException('Accountability expense not found');
    }

    if (existingExpense.accountabilityAccount.userId !== currentUser.id) {
      throw new ForbiddenException('Only owner can submit accountability expense');
    }

    if (existingExpense.status !== 'draft') {
      throw new ConflictException('Only draft expense can be submitted');
    }

    this.assertAccountAllowsOwnExpenseWrite(
      existingExpense.accountabilityAccount.status,
    );

    const submittedExpense = await this.prisma.accountabilityExpense.update({
      where: {
        id: expenseId,
      },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
      },
      include: this.accountabilityExpenseInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_expense',
      entityId: submittedExpense.id,
      actorUserId: currentUser.id,
      action: 'accountability_expense_submitted',
      newValues: {
        status: 'submitted',
      },
    });

    const attachmentsByEntityId = await this.loadExpenseAttachments([
      submittedExpense.id,
    ]);

    return this.mapExpense({
      expense: submittedExpense,
      currentUser,
      attachments: attachmentsByEntityId.get(submittedExpense.id) ?? [],
    });
  }

  async approveExpense(
    currentUser: CurrentAuthUser,
    expenseId: string,
  ): Promise<AccountabilityExpenseResponseDto> {
    this.assertCanApproveExpense(currentUser);

    const existingExpense = await this.prisma.accountabilityExpense.findFirst({
      where: {
        id: expenseId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existingExpense) {
      throw new NotFoundException('Accountability expense not found');
    }

    if (existingExpense.status !== 'submitted') {
      throw new ConflictException('Only submitted expense can be approved');
    }

    const approvedExpense = await this.prisma.accountabilityExpense.update({
      where: {
        id: expenseId,
      },
      data: {
        status: 'approved',
        approvedByUserId: currentUser.id,
        approvedAt: new Date(),
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionComment: null,
      },
      include: this.accountabilityExpenseInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_expense',
      entityId: approvedExpense.id,
      actorUserId: currentUser.id,
      action: 'accountability_expense_approved',
      newValues: {
        status: 'approved',
      },
    });

    const attachmentsByEntityId = await this.loadExpenseAttachments([
      approvedExpense.id,
    ]);

    return this.mapExpense({
      expense: approvedExpense,
      currentUser,
      attachments: attachmentsByEntityId.get(approvedExpense.id) ?? [],
    });
  }

  async rejectExpense(
    currentUser: CurrentAuthUser,
    expenseId: string,
    payload: RejectAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    this.assertCanApproveExpense(currentUser);

    const existingExpense = await this.prisma.accountabilityExpense.findFirst({
      where: {
        id: expenseId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existingExpense) {
      throw new NotFoundException('Accountability expense not found');
    }

    if (existingExpense.status !== 'submitted') {
      throw new ConflictException('Only submitted expense can be rejected');
    }

    const rejectionComment = payload.comment.trim();

    if (!rejectionComment) {
      throw new BadRequestException('Expense rejection comment is required');
    }

    const rejectedExpense = await this.prisma.accountabilityExpense.update({
      where: {
        id: expenseId,
      },
      data: {
        status: 'rejected',
        rejectedByUserId: currentUser.id,
        rejectedAt: new Date(),
        rejectionComment,
        approvedByUserId: null,
        approvedAt: null,
      },
      include: this.accountabilityExpenseInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_expense',
      entityId: rejectedExpense.id,
      actorUserId: currentUser.id,
        action: 'accountability_expense_rejected',
        newValues: {
          status: 'rejected',
          rejectionComment,
        },
      });

    const attachmentsByEntityId = await this.loadExpenseAttachments([
      rejectedExpense.id,
    ]);

    return this.mapExpense({
      expense: rejectedExpense,
      currentUser,
      attachments: attachmentsByEntityId.get(rejectedExpense.id) ?? [],
    });
  }

  async requestClosure(
    currentUser: CurrentAuthUser,
  ): Promise<AccountabilityClosureResponseDto> {
    const account = await this.getRequiredOwnActiveAccount(currentUser.id);

    if (account.status !== 'active') {
      throw new ConflictException(
        'Accountability account is not available for closure request',
      );
    }

    const draftExpensesCount = await this.prisma.accountabilityExpense.count({
      where: {
        accountabilityAccountId: account.id,
        status: 'draft',
      },
    });

    if (draftExpensesCount > 0) {
      throw new ConflictException(
        'Draft expenses must be submitted or removed before closure request',
      );
    }

    const closure = await this.prisma.$transaction(async (tx) => {
      await tx.accountabilityAccount.update({
        where: {
          id: account.id,
        },
        data: {
          status: 'closing_requested',
        },
      });

      const createdClosure = await tx.accountabilityClosure.create({
        data: {
          accountabilityAccountId: account.id,
          requestedByUserId: currentUser.id,
          status: 'requested',
        },
        include: this.accountabilityClosureInclude(),
      });

      await this.auditService.writeAuditEvent({
        entityType: 'accountability_closure',
        entityId: createdClosure.id,
        actorUserId: currentUser.id,
        action: 'accountability_closure_requested',
        newValues: {
          accountabilityAccountId: account.id,
          status: 'requested',
        },
      });

      return createdClosure;
    });

    return this.mapClosure({
      closure,
      currentUser,
    });
  }

  async approveClosure(
    currentUser: CurrentAuthUser,
    closureId: string,
  ): Promise<AccountabilityClosureResponseDto> {
    this.assertCanApproveClosure(currentUser);

    const currentClosure = await this.prisma.accountabilityClosure.findFirst({
      where: {
        id: closureId,
      },
      include: {
        accountabilityAccount: {
          include: {
            expenses: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!currentClosure) {
      throw new NotFoundException('Accountability closure not found');
    }

    if (currentClosure.status !== 'requested') {
      throw new ConflictException('Only requested closure can be approved');
    }

    if (currentClosure.accountabilityAccount.status !== 'closing_requested') {
      throw new ConflictException(
        'Accountability account is not waiting for closure approval',
      );
    }

    const unresolvedExpense = currentClosure.accountabilityAccount.expenses.find(
      (expense) =>
        expense.status === 'draft' || expense.status === 'submitted',
    );

    if (unresolvedExpense) {
      throw new ConflictException(
        'Submitted or draft expenses must be resolved before final closure approval',
      );
    }

    const approvedClosure = await this.prisma.$transaction(async (tx) => {
      await tx.accountabilityExpense.updateMany({
        where: {
          accountabilityAccountId: currentClosure.accountabilityAccountId,
          status: 'approved',
        },
        data: {
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      await tx.accountabilityAccount.update({
        where: {
          id: currentClosure.accountabilityAccountId,
        },
        data: {
          status: 'closed',
        },
      });

      const closure = await tx.accountabilityClosure.update({
        where: {
          id: closureId,
        },
        data: {
          status: 'approved',
          approvedByUserId: currentUser.id,
          approvedAt: new Date(),
        },
        include: this.accountabilityClosureInclude(),
      });

      await this.auditService.writeAuditEvent({
        entityType: 'accountability_closure',
        entityId: closure.id,
        actorUserId: currentUser.id,
        action: 'accountability_closure_approved',
        newValues: {
          status: 'approved',
        },
      });

      return closure;
    });

    return this.mapClosure({
      closure: approvedClosure,
      currentUser,
    });
  }

  async rejectClosure(
    currentUser: CurrentAuthUser,
    closureId: string,
    payload: RejectAccountabilityClosureDto,
  ): Promise<AccountabilityClosureResponseDto> {
    this.assertCanApproveClosure(currentUser);

    const currentClosure = await this.prisma.accountabilityClosure.findFirst({
      where: {
        id: closureId,
      },
      select: {
        id: true,
        status: true,
        accountabilityAccountId: true,
      },
    });

    if (!currentClosure) {
      throw new NotFoundException('Accountability closure not found');
    }

    if (currentClosure.status !== 'requested') {
      throw new ConflictException('Only requested closure can be rejected');
    }

    const rejectionComment = payload.comment.trim();

    if (!rejectionComment) {
      throw new BadRequestException('Closure rejection comment is required');
    }

    const rejectedClosure = await this.prisma.$transaction(async (tx) => {
      await tx.accountabilityAccount.update({
        where: {
          id: currentClosure.accountabilityAccountId,
        },
        data: {
          status: 'active',
        },
      });

      const closure = await tx.accountabilityClosure.update({
        where: {
          id: closureId,
        },
        data: {
          status: 'rejected',
          rejectedByUserId: currentUser.id,
          rejectedAt: new Date(),
          comment: rejectionComment,
        },
        include: this.accountabilityClosureInclude(),
      });

      await this.auditService.writeAuditEvent({
        entityType: 'accountability_closure',
        entityId: closure.id,
        actorUserId: currentUser.id,
        action: 'accountability_closure_rejected',
        newValues: {
          status: 'rejected',
          comment: rejectionComment,
        },
      });

      return closure;
    });

    return this.mapClosure({
      closure: rejectedClosure,
      currentUser,
    });
  }

  private async buildAccountView(params: {
    currentUser: CurrentAuthUser;
    subjectUserId: string;
  }): Promise<AccountabilityAccountViewDto> {
    const subjectUser = await this.prisma.user.findFirst({
      where: {
        id: params.subjectUserId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
              },
            },
          },
        },
      },
    });

    if (!subjectUser) {
      throw new NotFoundException('Accountability user not found');
    }

    const account = await this.prisma.accountabilityAccount.findUnique({
      where: {
        userId: params.subjectUserId,
      },
      include: {
        fundings: {
          include: {
            issuedBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
                roles: {
                  select: {
                    role: {
                      select: {
                        code: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            issuedAt: 'desc',
          },
        },
        expenses: {
          include: this.accountabilityExpenseInclude(),
          orderBy: {
            createdAt: 'desc',
          },
        },
        closures: {
          include: this.accountabilityClosureInclude(),
          orderBy: {
            requestedAt: 'desc',
          },
        },
      },
    });

    const summary = this.buildSummary({
      fundings: account?.fundings ?? [],
      expenses: account?.expenses ?? [],
    });

    const attachmentsByEntityId = await this.loadExpenseAttachments(
      account?.expenses.map((expense) => expense.id) ?? [],
    );

    const isOwnView = params.currentUser.id === params.subjectUserId;

    return {
      account: {
        id: account?.id ?? null,
        user: this.mapUserSummary(subjectUser),
        status: account?.status ?? null,
        createdAt: account?.createdAt ? account.createdAt.toISOString() : null,
        updatedAt: account?.updatedAt ? account.updatedAt.toISOString() : null,
      },
      summary,
      capabilities: {
        canCreateExpense:
          isOwnView &&
          account?.status === 'active' &&
          account.userId === params.currentUser.id,
        canRequestClosure:
          isOwnView &&
          account?.status === 'active' &&
          summary.draftExpensesCount === 0,
        canIssueFunding: canIssueAccountabilityFunds({
          roleCodes: this.getRoleCodes(params.currentUser),
          permissionCodes: this.getPermissionCodes(params.currentUser),
        }),
        canReviewExpenses: canApproveAccountabilityExpense({
          roleCodes: this.getRoleCodes(params.currentUser),
          permissionCodes: this.getPermissionCodes(params.currentUser),
        }),
        canApproveAccountabilityClosure: canApproveAccountabilityClosure({
          roleCodes: this.getRoleCodes(params.currentUser),
          permissionCodes: this.getPermissionCodes(params.currentUser),
        }),
      },
      fundings: (account?.fundings ?? []).map((funding) => this.mapFunding(funding)),
      expenses: (account?.expenses ?? []).map((expense) =>
        this.mapExpense({
          expense,
          currentUser: params.currentUser,
          attachments: attachmentsByEntityId.get(expense.id) ?? [],
        }),
      ),
      closures: (account?.closures ?? []).map((closure) =>
        this.mapClosure({
          closure,
          currentUser: params.currentUser,
        }),
      ),
    };
  }

  private accountabilityExpenseInclude() {
    return {
      accountabilityAccount: {
        select: {
          id: true,
          userId: true,
          status: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
      approvedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
      rejectedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
    } as const;
  }

  private accountabilityClosureInclude() {
    return {
      requestedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
      approvedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
      rejectedBy: {
        select: {
          id: true,
          login: true,
          fullName: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
    } as const;
  }

  private buildSummary(params: {
    fundings: Array<{
      amount: Prisma.Decimal;
    }>;
    expenses: Array<{
      amount: Prisma.Decimal;
      status: string;
    }>;
  }): AccountabilityAccountSummaryDto {
    const totalFunding = params.fundings.reduce(
      (sum, funding) => sum + funding.amount.toNumber(),
      0,
    );

    const totalRecordedExpenses = params.expenses.reduce(
      (sum, expense) => sum + expense.amount.toNumber(),
      0,
    );
    const totalApprovedExpenses = this.sumExpenseStatuses(params.expenses, [
      'approved',
    ]);
    const totalRejectedExpenses = this.sumExpenseStatuses(params.expenses, [
      'rejected',
    ]);
    const totalReconciledExpenses = this.sumExpenseStatuses(params.expenses, [
      'reconciled',
    ]);
    const currentBalance =
      totalFunding -
      this.sumExpenseStatuses(params.expenses, [
        'draft',
        'submitted',
        'approved',
        'reconciled',
      ]);

    return {
      totalFunding,
      totalRecordedExpenses,
      totalApprovedExpenses,
      totalRejectedExpenses,
      totalReconciledExpenses,
      currentBalance,
      submittedExpensesCount: params.expenses.filter(
        (expense) => expense.status === 'submitted',
      ).length,
      draftExpensesCount: params.expenses.filter(
        (expense) => expense.status === 'draft',
      ).length,
    };
  }

  private sumExpenseStatuses(
    expenses: Array<{
      amount: Prisma.Decimal;
      status: string;
    }>,
    statuses: string[],
  ): number {
    return expenses.reduce((sum, expense) => {
      if (!statuses.includes(expense.status)) {
        return sum;
      }

      return sum + expense.amount.toNumber();
    }, 0);
  }

  private async loadExpenseAttachments(
    expenseIds: string[],
  ): Promise<Map<string, FileResponseDto[]>> {
    const byEntityId = new Map<string, FileResponseDto[]>();

    if (expenseIds.length === 0) {
      return byEntityId;
    }

    const attachments = await this.prisma.fileAttachment.findMany({
      where: {
        entityType: EXPENSE_ATTACHMENTS_ENTITY_TYPE,
        entityId: {
          in: expenseIds,
        },
      },
      include: {
        file: {
          include: {
            attachments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const attachment of attachments) {
      const current = byEntityId.get(attachment.entityId) ?? [];
      current.push(this.mapFile(attachment.file));
      byEntityId.set(attachment.entityId, current);
    }

    return byEntityId;
  }

  private mapFunding(funding: {
    id: string;
    amount: Prisma.Decimal;
    comment: string | null;
    issuedAt: Date;
    issuedBy: {
      id: string;
      login: string;
      fullName: string;
      roles: Array<{
        role: {
          code: string;
        };
      }>;
    };
  }): AccountabilityFundingResponseDto {
    return {
      id: funding.id,
      amount: funding.amount.toNumber(),
      comment: funding.comment,
      issuedAt: funding.issuedAt.toISOString(),
      issuedBy: this.mapUserSummary(funding.issuedBy),
    };
  }

  private mapExpense(params: {
    expense: {
      id: string;
      amount: Prisma.Decimal;
      description: string;
      status: string;
      submittedAt: Date | null;
      approvedAt: Date | null;
      rejectedAt: Date | null;
      rejectionComment: string | null;
      reconciledAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      accountabilityAccount: {
        userId: string;
      };
      createdBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      };
      approvedBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      } | null;
      rejectedBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      } | null;
    };
    currentUser: CurrentAuthUser;
    attachments: FileResponseDto[];
  }): AccountabilityExpenseResponseDto {
    return {
      id: params.expense.id,
      amount: params.expense.amount.toNumber(),
      description: params.expense.description,
      status: params.expense.status,
      submittedAt: params.expense.submittedAt?.toISOString() ?? null,
      approvedAt: params.expense.approvedAt?.toISOString() ?? null,
      rejectedAt: params.expense.rejectedAt?.toISOString() ?? null,
      rejectionComment: params.expense.rejectionComment,
      reconciledAt: params.expense.reconciledAt?.toISOString() ?? null,
      createdAt: params.expense.createdAt.toISOString(),
      updatedAt: params.expense.updatedAt.toISOString(),
      createdBy: this.mapUserSummary(params.expense.createdBy),
      approvedBy: params.expense.approvedBy
        ? this.mapUserSummary(params.expense.approvedBy)
        : null,
      rejectedBy: params.expense.rejectedBy
        ? this.mapUserSummary(params.expense.rejectedBy)
        : null,
      attachments: params.attachments,
      capabilities: buildAccountabilityExpenseCapabilities({
        isOwnExpense:
          params.expense.accountabilityAccount.userId === params.currentUser.id,
        status: params.expense.status,
        roleCodes: this.getRoleCodes(params.currentUser),
        permissionCodes: this.getPermissionCodes(params.currentUser),
      }),
    };
  }

  private mapClosure(params: {
    closure: {
      id: string;
      status: string;
      requestedAt: Date;
      approvedAt: Date | null;
      rejectedAt: Date | null;
      comment: string | null;
      requestedBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      };
      approvedBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      } | null;
      rejectedBy: {
        id: string;
        login: string;
        fullName: string;
        roles: Array<{
          role: {
            code: string;
          };
        }>;
      } | null;
    };
    currentUser: CurrentAuthUser;
  }): AccountabilityClosureResponseDto {
    const canResolve =
      params.closure.status === 'requested' &&
      canApproveAccountabilityClosure({
        roleCodes: this.getRoleCodes(params.currentUser),
        permissionCodes: this.getPermissionCodes(params.currentUser),
      });

    return {
      id: params.closure.id,
      status: params.closure.status,
      requestedAt: params.closure.requestedAt.toISOString(),
      approvedAt: params.closure.approvedAt?.toISOString() ?? null,
      rejectedAt: params.closure.rejectedAt?.toISOString() ?? null,
      comment: params.closure.comment,
      requestedBy: this.mapUserSummary(params.closure.requestedBy),
      approvedBy: params.closure.approvedBy
        ? this.mapUserSummary(params.closure.approvedBy)
        : null,
      rejectedBy: params.closure.rejectedBy
        ? this.mapUserSummary(params.closure.rejectedBy)
        : null,
      capabilities: {
        canApprove: canResolve,
        canReject: canResolve,
      },
    };
  }

  private mapUserSummary(user: {
    id: string;
    login: string;
    fullName: string;
    roles: Array<{
      role: {
        code: string;
      };
    }>;
  }): AccountabilityUserSummaryDto {
    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      roleCodes: user.roles.map((item) => item.role.code),
    };
  }

  private mapFile(file: {
    id: string;
    bucket: string;
    objectKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByUserId: string | null;
    createdAt: Date;
    attachments: Array<{
      id: string;
      entityType: string;
      entityId: string;
      fieldCode: string | null;
      uploadedByUserId: string | null;
      createdAt: Date;
    }>;
  }): FileResponseDto {
    return {
      id: file.id,
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt.toISOString(),
      url: `/api/v1/files/${file.id}/content`,
      attachments: file.attachments.map((attachment) => ({
        id: attachment.id,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        fieldCode: attachment.fieldCode,
        uploadedByUserId: attachment.uploadedByUserId,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  }

  private async getRequiredOwnActiveAccount(userId: string) {
    const account = await this.prisma.accountabilityAccount.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!account) {
      throw new BadRequestException(
        'No accountability account exists for current user yet',
      );
    }

    return account;
  }

  private assertAccountAllowsOwnExpenseWrite(status: string): void {
    if (status !== 'active') {
      throw new ConflictException(
        'Accountability account is locked for new expense actions',
      );
    }
  }

  private assertCanReview(currentUser: CurrentAuthUser): void {
    if (
      !canReviewAccountability({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      throw new ForbiddenException('Accountability review access denied');
    }
  }

  private assertCanIssueFunding(currentUser: CurrentAuthUser): void {
    if (
      !canIssueAccountabilityFunds({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      throw new ForbiddenException('Accountability funding issuance denied');
    }
  }

  private assertCanApproveExpense(currentUser: CurrentAuthUser): void {
    if (
      !canApproveAccountabilityExpense({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      throw new ForbiddenException('Expense review access denied');
    }
  }

  private assertCanApproveClosure(currentUser: CurrentAuthUser): void {
    if (
      !canApproveAccountabilityClosure({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      throw new ForbiddenException('Accountability closure approval denied');
    }
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return [currentUser.roleCode];
  }

  private getPermissionCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.permissionCodes ?? [];
  }
}
