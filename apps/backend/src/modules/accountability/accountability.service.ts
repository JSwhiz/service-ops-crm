import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import {
  ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
  ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import { SafeFileResponseDto } from '../files/dto/safe-file-response.dto';
import { mapSafeFileResponse } from '../files/utils/safe-file-response.mapper';
import { buildOneTimeOrderAccessWhere } from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';

import {
  AccountabilityAccountListItemDto,
  AccountabilityAccountSummaryDto,
  AccountabilityAccountViewDto,
  AccountabilityClosureResponseDto,
  AccountabilityExpenseResponseDto,
  AccountabilityFundingResponseDto,
  AccountabilityUserSummaryDto,
  OneTimeOrderAccountabilityViewDto,
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
  ACCOUNTABILITY_EXPENSE_CATEGORIES,
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
    await this.assertCanViewOwnAccountability(currentUser);

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
            entryDirection: true,
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

    if (
      isOwnAccount &&
      !canReviewAccountability({
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
      })
    ) {
      await this.assertCanViewOwnAccountability(currentUser);
    } else if (!isOwnAccount) {
      this.assertCanReview(currentUser);
    }

    return this.buildAccountView({
      currentUser,
      subjectUserId: userId,
    });
  }

  async getOneTimeOrderAccountability(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OneTimeOrderAccountabilityViewDto> {
    const canReview = canReviewAccountability({
      roleCodes: this.getRoleCodes(currentUser),
      permissionCodes: this.getPermissionCodes(currentUser),
    });
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        id: orderId,
        ...buildOneTimeOrderAccessWhere({
          currentUserId: currentUser.id,
          roleCodes: this.getRoleCodes(currentUser),
          permissionCodes: this.getPermissionCodes(currentUser),
        }),
      },
      select: {
        id: true,
        title: true,
        assignments: {
          where: {
            userId: currentUser.id,
            assignmentRoleCode: 'one_time_manager',
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    const canViewOwn = await this.canCurrentUserViewOwnAccountability(
      currentUser,
    );
    const accounts = await this.prisma.accountabilityAccount.findMany({
      where:
        !canReview && !canViewOwn
          ? { id: { in: [] } }
          : canReview
            ? {
                OR: [
                  { fundings: { some: { oneTimeOrderId: orderId } } },
                  { expenses: { some: { oneTimeOrderId: orderId } } },
                ],
              }
            : { userId: currentUser.id },
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            roles: {
              select: {
                role: {
                  select: { code: true },
                },
              },
            },
          },
        },
        fundings: {
          where: { oneTimeOrderId: orderId },
          include: {
            issuedBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
                roles: {
                  select: { role: { select: { code: true } } },
                },
              },
            },
            recordedBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
                roles: {
                  select: { role: { select: { code: true } } },
                },
              },
            },
          },
          orderBy: { issuedAt: 'desc' },
        },
        expenses: {
          where: { oneTimeOrderId: orderId },
          include: this.accountabilityExpenseInclude(),
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { user: { fullName: 'asc' } },
    });
    const attachmentsByEntityId = await this.loadExpenseAttachments(
      accounts.flatMap((account) =>
        account.expenses.map((expense) => expense.id),
      ),
    );
    const ownAccount = accounts.find(
      (account) => account.userId === currentUser.id,
    );

    return {
      order: {
        id: order.id,
        title: order.title,
      },
      visibilityScope: canReview ? 'administrative' : 'own',
      capabilities: {
        canCreateExpense:
          canViewOwn &&
          order.assignments.length > 0 &&
          ownAccount?.status === 'active',
        canReviewExpenses: canReview,
      },
      accounts: accounts.map((account) => ({
        accountId: account.id,
        accountStatus: account.status,
        user: this.mapUserSummary(account.user),
        summary: this.buildSummary({
          fundings: account.fundings,
          expenses: account.expenses,
        }),
        fundings: account.fundings.map((funding) => this.mapFunding(funding)),
        expenses: account.expenses.map((expense) =>
          this.mapExpense({
            expense,
            currentUser,
            attachments: attachmentsByEntityId.get(expense.id) ?? [],
          }),
        ),
      })),
    };
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
          fundingType: 'manual_issue',
          entryDirection: 'credit',
          recordedByUserId: currentUser.id,
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
          recordedBy: {
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
    await this.assertCanViewOwnAccountability(currentUser);
    const account = await this.getRequiredOwnActiveAccount(currentUser.id);
    this.assertAccountAllowsOwnExpenseWrite(account.status);
    const description = payload.description.trim();

    if (!description) {
      throw new BadRequestException('Expense description is required');
    }

    const orderExpense = await this.normalizeOrderExpenseInput({
      currentUser,
      oneTimeOrderId: payload.oneTimeOrderId ?? null,
      expenseCategory: payload.expenseCategory ?? null,
      expenseDate: payload.expenseDate ?? null,
    });

    const createdExpense = await this.prisma.accountabilityExpense.create({
      data: {
        accountabilityAccountId: account.id,
        oneTimeOrderId: orderExpense.oneTimeOrderId,
        expenseCategory: orderExpense.expenseCategory,
        expenseDate: orderExpense.expenseDate,
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
          oneTimeOrderId: orderExpense.oneTimeOrderId,
          expenseCategory: orderExpense.expenseCategory,
          expenseDate: orderExpense.expenseDate?.toISOString() ?? null,
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
    await this.assertCanViewOwnAccountability(currentUser);
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

    const orderExpense = await this.normalizeOrderExpenseInput({
      currentUser,
      oneTimeOrderId:
        payload.oneTimeOrderId ?? existingExpense.oneTimeOrderId ?? null,
      expenseCategory:
        payload.expenseCategory ?? existingExpense.expenseCategory ?? null,
      expenseDate:
        payload.expenseDate ??
        this.formatDateOnly(existingExpense.expenseDate) ??
        null,
    });

    const updatedExpense = await this.prisma.accountabilityExpense.update({
      where: {
        id: expenseId,
      },
      data: {
        amount: new Prisma.Decimal(payload.amount),
        description,
        oneTimeOrderId: orderExpense.oneTimeOrderId,
        expenseCategory: orderExpense.expenseCategory,
        expenseDate: orderExpense.expenseDate,
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
          oneTimeOrderId: orderExpense.oneTimeOrderId,
          expenseCategory: orderExpense.expenseCategory,
          expenseDate: orderExpense.expenseDate?.toISOString() ?? null,
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
    await this.assertCanViewOwnAccountability(currentUser);
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

    if (existingExpense.oneTimeOrderId) {
      const attachmentCount = await this.prisma.fileAttachment.count({
        where: {
          entityType: EXPENSE_ATTACHMENTS_ENTITY_TYPE,
          entityId: existingExpense.id,
        },
      });

      if (attachmentCount === 0) {
        throw new ConflictException(
          'One-time order expense requires a receipt or document',
        );
      }
    }

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
    await this.assertCanViewOwnAccountability(currentUser);
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

    const closureCreation = await this.prisma.$transaction(async (tx) => {
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

      const approvalRequest = await tx.approvalRequest.create({
        data: {
          approvalType: ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
          sourceEntityType: ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: createdClosure.id,
          createdByUserId: currentUser.id,
          payloadSnapshot: {
            summaryTitle: 'Сверка подотчета',
            summarySubtitle: `${currentUser.fullName} · ${currentUser.login}`,
            accountabilityAccountId: account.id,
            requestedByUserId: currentUser.id,
            requestedAt: createdClosure.requestedAt.toISOString(),
          },
        },
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

      return {
        closure: createdClosure,
        approvalRequestId: approvalRequest.id,
      };
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: closureCreation.approvalRequestId,
      actorUserId: currentUser.id,
      action: 'approval.request.created',
      newValues: {
        approvalType: ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
        sourceEntityType: ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: closureCreation.closure.id,
      },
    });

    return this.mapClosure({
      closure: closureCreation.closure,
      currentUser,
    });
  }

  async approveClosure(
    currentUser: CurrentAuthUser,
    closureId: string,
  ): Promise<AccountabilityClosureResponseDto> {
    this.assertCanApproveClosure(currentUser);
    const approvalRequest = await this.findPendingClosureApprovalRequest(closureId);

    const approvedClosure = await this.prisma.$transaction(async (tx) => {
      const closure = await this.applyClosureApprovalDecision(tx, {
        closureId,
        decision: 'approve',
        actorUserId: currentUser.id,
      });

      if (approvalRequest) {
        await tx.approvalRequest.update({
          where: {
            id: approvalRequest.id,
          },
          data: {
            status: 'approved',
            resolvedByUserId: currentUser.id,
            resolvedAt: new Date(),
            decisionComment: null,
          },
        });
      }

      return closure;
    });

    if (approvalRequest) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: approvalRequest.id,
        actorUserId: currentUser.id,
        action: 'approval.request.approved',
        newValues: {
          approvalType: ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
          sourceEntityType: ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: closureId,
        },
      });
    }

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

    const rejectionComment = payload.comment.trim();

    if (!rejectionComment) {
      throw new BadRequestException('Closure rejection comment is required');
    }
    const approvalRequest = await this.findPendingClosureApprovalRequest(closureId);

    const rejectedClosure = await this.prisma.$transaction(async (tx) => {
      const closure = await this.applyClosureApprovalDecision(tx, {
        closureId,
        decision: 'reject',
        actorUserId: currentUser.id,
        comment: rejectionComment,
      });

      if (approvalRequest) {
        await tx.approvalRequest.update({
          where: {
            id: approvalRequest.id,
          },
          data: {
            status: 'rejected',
            resolvedByUserId: currentUser.id,
            resolvedAt: new Date(),
            decisionComment: rejectionComment,
          },
        });
      }

      return closure;
    });

    if (approvalRequest) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: approvalRequest.id,
        actorUserId: currentUser.id,
        action: 'approval.request.rejected',
        newValues: {
          approvalType: ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
          sourceEntityType: ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: closureId,
          decisionComment: rejectionComment,
        },
      });
    }

    return this.mapClosure({
      closure: rejectedClosure,
      currentUser,
    });
  }

  async applyClosureApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      closureId: string;
      decision: 'approve' | 'reject';
      actorUserId: string;
      comment?: string;
    },
  ) {
    const currentClosure = await tx.accountabilityClosure.findFirst({
      where: {
        id: params.closureId,
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
        ...this.accountabilityClosureInclude(),
      },
    });

    if (!currentClosure) {
      throw new NotFoundException('Accountability closure not found');
    }

    if (currentClosure.status !== 'requested') {
      throw new ConflictException(
        `Only requested closure can be ${params.decision === 'approve' ? 'approved' : 'rejected'}`,
      );
    }

    if (currentClosure.accountabilityAccount.status !== 'closing_requested') {
      throw new ConflictException(
        'Accountability account is not waiting for closure approval',
      );
    }

    if (params.decision === 'approve') {
      const unresolvedExpense =
        currentClosure.accountabilityAccount.expenses.find(
          (expense) =>
            expense.status === 'draft' || expense.status === 'submitted',
        );

      if (unresolvedExpense) {
        throw new ConflictException(
          'Submitted or draft expenses must be resolved before final closure approval',
        );
      }

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
          status: 'active',
        },
      });

      const closure = await tx.accountabilityClosure.update({
        where: {
          id: params.closureId,
        },
        data: {
          status: 'approved',
          approvedByUserId: params.actorUserId,
          approvedAt: new Date(),
        },
        include: this.accountabilityClosureInclude(),
      });

      await this.auditService.writeAuditEvent({
        entityType: 'accountability_closure',
        entityId: closure.id,
        actorUserId: params.actorUserId,
        action: 'accountability_closure_approved',
        newValues: {
          status: 'approved',
        },
      });

      return closure;
    }

    const rejectionComment = params.comment?.trim();

    if (!rejectionComment) {
      throw new BadRequestException('Closure rejection comment is required');
    }

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
        id: params.closureId,
      },
      data: {
        status: 'rejected',
        rejectedByUserId: params.actorUserId,
        rejectedAt: new Date(),
        comment: rejectionComment,
      },
      include: this.accountabilityClosureInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'accountability_closure',
      entityId: closure.id,
      actorUserId: params.actorUserId,
      action: 'accountability_closure_rejected',
      newValues: {
        status: 'rejected',
        comment: rejectionComment,
      },
    });

    return closure;
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
            recordedBy: {
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
      entryDirection: string;
    }>;
    expenses: Array<{
      amount: Prisma.Decimal;
      status: string;
    }>;
  }): AccountabilityAccountSummaryDto {
    const totalCredits = params.fundings.reduce(
      (sum, funding) =>
        funding.entryDirection === 'credit'
          ? sum + funding.amount.toNumber()
          : sum,
      0,
    );
    const totalDebits = params.fundings.reduce(
      (sum, funding) =>
        funding.entryDirection === 'debit'
          ? sum + funding.amount.toNumber()
          : sum,
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
      totalCredits -
      totalDebits -
      this.sumExpenseStatuses(params.expenses, ['approved', 'reconciled']);
    const forecastBalance =
      currentBalance - this.sumExpenseStatuses(params.expenses, ['submitted']);

    return {
      totalFunding: totalCredits,
      totalCredits,
      totalDebits,
      totalRecordedExpenses,
      totalApprovedExpenses,
      totalRejectedExpenses,
      totalReconciledExpenses,
      currentBalance,
      forecastBalance,
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
  ): Promise<Map<string, SafeFileResponseDto[]>> {
    const byEntityId = new Map<string, SafeFileResponseDto[]>();

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
      select: {
        entityId: true,
        file: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const attachment of attachments) {
      const current = byEntityId.get(attachment.entityId) ?? [];
      current.push(mapSafeFileResponse(attachment.file));
      byEntityId.set(attachment.entityId, current);
    }

    return byEntityId;
  }

  private mapFunding(funding: {
    id: string;
    amount: Prisma.Decimal;
    comment: string | null;
    issuedAt: Date;
    fundingType: string;
    entryDirection: string;
    oneTimeOrderPaymentId: string | null;
    oneTimeOrderId: string | null;
    oneTimeOrderCompletionId: string | null;
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
    recordedBy: {
      id: string;
      login: string;
      fullName: string;
      roles: Array<{
        role: {
          code: string;
        };
      }>;
    } | null;
  }): AccountabilityFundingResponseDto {
    return {
      id: funding.id,
      amount: funding.amount.toNumber(),
      comment: funding.comment,
      issuedAt: funding.issuedAt.toISOString(),
      fundingType: funding.fundingType,
      entryDirection: funding.entryDirection,
      oneTimeOrderPaymentId: funding.oneTimeOrderPaymentId,
      oneTimeOrderId: funding.oneTimeOrderId,
      oneTimeOrderCompletionId: funding.oneTimeOrderCompletionId,
      issuedBy: this.mapUserSummary(funding.issuedBy),
      recordedBy: funding.recordedBy
        ? this.mapUserSummary(funding.recordedBy)
        : null,
    };
  }

  private mapExpense(params: {
    expense: {
      id: string;
      oneTimeOrderId: string | null;
      oneTimeOrderCompletionId: string | null;
      expenseCategory: string | null;
      expenseDate: Date | null;
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
    attachments: SafeFileResponseDto[];
  }): AccountabilityExpenseResponseDto {
    return {
      id: params.expense.id,
      oneTimeOrderId: params.expense.oneTimeOrderId,
      oneTimeOrderCompletionId: params.expense.oneTimeOrderCompletionId,
      expenseCategory: params.expense.expenseCategory,
      expenseDate: this.formatDateOnly(params.expense.expenseDate),
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

  private async findPendingClosureApprovalRequest(closureId: string) {
    return this.prisma.approvalRequest.findFirst({
      where: {
        approvalType: ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
        sourceEntityType: ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: closureId,
        status: 'pending',
      },
      select: {
        id: true,
      },
    });
  }

  private assertAccountAllowsOwnExpenseWrite(status: string): void {
    if (status !== 'active') {
      throw new ConflictException(
        'Accountability account is locked for new expense actions',
      );
    }
  }

  private async normalizeOrderExpenseInput(params: {
    currentUser: CurrentAuthUser;
    oneTimeOrderId: string | null;
    expenseCategory: string | null;
    expenseDate: string | null;
  }): Promise<{
    oneTimeOrderId: string | null;
    expenseCategory: string | null;
    expenseDate: Date | null;
  }> {
    if (
      params.expenseCategory &&
      !ACCOUNTABILITY_EXPENSE_CATEGORIES.includes(
        params.expenseCategory as never,
      )
    ) {
      throw new BadRequestException('Unsupported accountability expense category');
    }

    const expenseDate = params.expenseDate
      ? this.parseDateOnly(params.expenseDate)
      : null;

    if (params.oneTimeOrderId) {
      if (!params.expenseCategory || !expenseDate) {
        throw new BadRequestException(
          'One-time order expense requires category and expense date',
        );
      }

      await this.assertCanLinkExpenseToOneTimeOrder(
        params.currentUser,
        params.oneTimeOrderId,
      );
    }

    return {
      oneTimeOrderId: params.oneTimeOrderId,
      expenseCategory: params.expenseCategory,
      expenseDate,
    };
  }

  private async assertCanLinkExpenseToOneTimeOrder(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<void> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        id: orderId,
        ...buildOneTimeOrderAccessWhere({
          currentUserId: currentUser.id,
          roleCodes: this.getRoleCodes(currentUser),
          permissionCodes: this.getPermissionCodes(currentUser),
        }),
        assignments: {
          some: {
            userId: currentUser.id,
            assignmentRoleCode: 'one_time_manager',
          },
        },
      },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Available one-time order assignment not found');
    }
  }

  private parseDateOnly(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('Expense date must be a valid date');
    }

    return parsed;
  }

  private formatDateOnly(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
  }

  private async assertCanViewOwnAccountability(
    currentUser: CurrentAuthUser,
  ): Promise<void> {
    if (!(await this.canCurrentUserViewOwnAccountability(currentUser))) {
      throw new ForbiddenException('Access to own accountability is denied');
    }
  }

  private async canCurrentUserViewOwnAccountability(
    currentUser: CurrentAuthUser,
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (canViewOwnAccountability({ roleCodes })) {
      return true;
    }

    const [activeManagerAssignment, historicalReceipt] = await Promise.all([
      this.prisma.oneTimeOrderAssignment.findFirst({
        where: {
          userId: currentUser.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
        select: { id: true },
      }),
      this.prisma.accountabilityFunding.findFirst({
        where: {
          fundingType: 'one_time_order_receipt',
          accountabilityAccount: {
            userId: currentUser.id,
          },
        },
        select: { id: true },
      }),
    ]);

    return canViewOwnAccountability({
      roleCodes,
      hasActiveOneTimeManagerAssignment: activeManagerAssignment !== null,
      hasHistoricalOneTimeOrderReceipt: historicalReceipt !== null,
    });
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
