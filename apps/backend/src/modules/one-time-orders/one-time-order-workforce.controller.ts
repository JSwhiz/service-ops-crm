import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  AddOneTimeOrderEmployeeDto,
  OneTimeOrderTimesheetQueryDto,
  SubmitOneTimeOrderAttendanceDto,
} from './dto/one-time-order-workforce.dto';
import {
  OneTimeOrderAttendanceResponse,
  OneTimeOrderTimesheetResponse,
  OneTimeOrderWorkforceEmployee,
  OneTimeOrderWorkforceService,
} from './one-time-order-workforce.service';

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
@Controller('one-time-orders/:orderId/workforce')
export class OneTimeOrderWorkforceController {
  constructor(
    private readonly oneTimeOrderWorkforceService: OneTimeOrderWorkforceService,
  ) {}

  @Get('employees')
  listEmployees(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    return this.oneTimeOrderWorkforceService.listEmployees(user, orderId);
  }

  @Post('employees')
  addEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Body() payload: AddOneTimeOrderEmployeeDto,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    return this.oneTimeOrderWorkforceService.addEmployee(user, orderId, payload);
  }

  @Delete('employees/:employeeId')
  removeEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    return this.oneTimeOrderWorkforceService.removeEmployee(
      user,
      orderId,
      employeeId,
    );
  }

  @Get('attendance/today')
  getTodayAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
  ): Promise<OneTimeOrderAttendanceResponse> {
    return this.oneTimeOrderWorkforceService.getTodayAttendance(user, orderId);
  }

  @Post('attendance/today')
  submitTodayAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Body() payload: SubmitOneTimeOrderAttendanceDto,
  ): Promise<OneTimeOrderAttendanceResponse> {
    return this.oneTimeOrderWorkforceService.submitTodayAttendance(
      user,
      orderId,
      payload.employeeIds,
    );
  }

  @Get('timesheet')
  getTimesheet(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Query() query: OneTimeOrderTimesheetQueryDto,
  ): Promise<OneTimeOrderTimesheetResponse> {
    return this.oneTimeOrderWorkforceService.getTimesheet(
      user,
      orderId,
      query.month,
      query.workCycle,
    );
  }
}
