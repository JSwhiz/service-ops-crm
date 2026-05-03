import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ApprovalRequestResponseDto } from './dto/approval-request-response.dto';
import { ListApprovalRequestsQueryDto } from './dto/list-approval-requests-query.dto';
import {
  ApproveApprovalRequestDto,
  CancelApprovalRequestDto,
  RejectApprovalRequestDto,
} from './dto/resolve-approval-request.dto';
import { ApprovalsService } from './approvals.service';

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
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  listRequests(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListApprovalRequestsQueryDto,
  ): Promise<ApprovalRequestResponseDto[]> {
    return this.approvalsService.listRequests(user, query);
  }

  @Get(':id')
  getRequestById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<ApprovalRequestResponseDto> {
    return this.approvalsService.getRequestById(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approveRequest(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: ApproveApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    return this.approvalsService.approveRequest(user, id, payload);
  }

  @Post(':id/reject')
  @HttpCode(200)
  rejectRequest(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: RejectApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    return this.approvalsService.rejectRequest(user, id, payload);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancelRequest(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CancelApprovalRequestDto,
  ): Promise<ApprovalRequestResponseDto> {
    return this.approvalsService.cancelRequest(user, id, payload);
  }
}
