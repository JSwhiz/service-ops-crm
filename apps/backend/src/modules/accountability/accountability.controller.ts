import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  AccountabilityAccountListItemDto,
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
import { AccountabilityService } from './accountability.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('accountability')
export class AccountabilityController {
  constructor(private readonly accountabilityService: AccountabilityService) {}

  @Get('me')
  getMyAccount(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<AccountabilityAccountViewDto> {
    return this.accountabilityService.getMyAccount(user);
  }

  @Get('accounts')
  listAccounts(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<AccountabilityAccountListItemDto[]> {
    return this.accountabilityService.listAccounts(user);
  }

  @Get('accounts/:userId')
  getAccountByUserId(
    @CurrentUser() user: CurrentAuthUser,
    @Param('userId') userId: string,
  ): Promise<AccountabilityAccountViewDto> {
    return this.accountabilityService.getAccountByUserId(user, userId);
  }

  @Get('orders/:orderId')
  getOneTimeOrderAccountability(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
  ): Promise<OneTimeOrderAccountabilityViewDto> {
    return this.accountabilityService.getOneTimeOrderAccountability(
      user,
      orderId,
    );
  }

  @Get('reference/users')
  listUserOptions(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<AccountabilityUserSummaryDto[]> {
    return this.accountabilityService.listUserOptions(user);
  }

  @Post('accounts/:userId/fundings')
  issueFunding(
    @CurrentUser() user: CurrentAuthUser,
    @Param('userId') userId: string,
    @Body() payload: CreateAccountabilityFundingDto,
  ): Promise<AccountabilityFundingResponseDto> {
    return this.accountabilityService.issueFunding(user, userId, payload);
  }

  @Post('me/expenses')
  createExpense(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: SaveAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    return this.accountabilityService.createExpense(user, payload);
  }

  @Patch('me/expenses/:expenseId')
  updateExpense(
    @CurrentUser() user: CurrentAuthUser,
    @Param('expenseId') expenseId: string,
    @Body() payload: SaveAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    return this.accountabilityService.updateExpense(user, expenseId, payload);
  }

  @Post('me/expenses/:expenseId/submit')
  @HttpCode(200)
  submitExpense(
    @CurrentUser() user: CurrentAuthUser,
    @Param('expenseId') expenseId: string,
  ): Promise<AccountabilityExpenseResponseDto> {
    return this.accountabilityService.submitExpense(user, expenseId);
  }

  @Post('expenses/:expenseId/approve')
  @HttpCode(200)
  approveExpense(
    @CurrentUser() user: CurrentAuthUser,
    @Param('expenseId') expenseId: string,
  ): Promise<AccountabilityExpenseResponseDto> {
    return this.accountabilityService.approveExpense(user, expenseId);
  }

  @Post('expenses/:expenseId/reject')
  @HttpCode(200)
  rejectExpense(
    @CurrentUser() user: CurrentAuthUser,
    @Param('expenseId') expenseId: string,
    @Body() payload: RejectAccountabilityExpenseDto,
  ): Promise<AccountabilityExpenseResponseDto> {
    return this.accountabilityService.rejectExpense(user, expenseId, payload);
  }

  @Post('me/closures/request')
  requestClosure(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<AccountabilityClosureResponseDto> {
    return this.accountabilityService.requestClosure(user);
  }

  @Post('closures/:closureId/approve')
  @HttpCode(200)
  approveClosure(
    @CurrentUser() user: CurrentAuthUser,
    @Param('closureId') closureId: string,
  ): Promise<AccountabilityClosureResponseDto> {
    return this.accountabilityService.approveClosure(user, closureId);
  }

  @Post('closures/:closureId/reject')
  @HttpCode(200)
  rejectClosure(
    @CurrentUser() user: CurrentAuthUser,
    @Param('closureId') closureId: string,
    @Body() payload: RejectAccountabilityClosureDto,
  ): Promise<AccountabilityClosureResponseDto> {
    return this.accountabilityService.rejectClosure(user, closureId, payload);
  }
}
