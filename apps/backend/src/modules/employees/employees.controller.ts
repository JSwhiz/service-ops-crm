import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateEmployeeAvailabilityDto } from './dto/create-employee-availability.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSubstitutionDto } from './dto/create-employee-substitution.dto';
import { AssignEmployeeToObjectDto } from './dto/assign-employee-to-object.dto';
import { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import { EmployeeListResponseDto } from './dto/employee-list-item.dto';
import { EmployeeObjectOptionDto } from './dto/employee-object-option.dto';
import { EmployeeResponseDto } from './dto/employee-response.dto';
import { EmployeeVersionDto } from './dto/employee-version.dto';
import {
  EmployeeAttendanceQueryDto,
  EmployeeAttendanceResponseDto,
} from './dto/employee-attendance.dto';
import {
  DeleteEmployeeAssignmentAsErrorDto,
  DeleteEmployeePermanentlyDto,
} from './dto/delete-employee-record.dto';
import {
  EmployeeObjectReferenceDto,
  EmployeePositionReferenceDto,
  ListEmployeeReferencesQueryDto,
} from './dto/list-employee-references-query.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';
import { EmployeeScheduleService } from './employee-schedule.service';
import {
  UpdateEmployeeAvailabilityDto,
  UpdateEmployeeSubstitutionDto,
} from './dto/update-employee-schedule.dto';

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
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly scheduleService: EmployeeScheduleService,
  ) {}

  @Get()
  listEmployees(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListEmployeesQueryDto,
  ): Promise<EmployeeListResponseDto> {
    return this.employeesService.listEmployees(user, query);
  }

  @Get('object-candidates')
  listObjectCandidates(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<EmployeeObjectOptionDto[]> {
    return this.employeesService.listObjectCandidates(user);
  }

  @Get('references/positions')
  listPositionReferences(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListEmployeeReferencesQueryDto,
  ): Promise<EmployeePositionReferenceDto[]> {
    return this.employeesService.listPositionReferences(user, query);
  }

  @Get('references/objects')
  listObjectReferences(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListEmployeeReferencesQueryDto,
  ): Promise<EmployeeObjectReferenceDto[]> {
    return this.employeesService.listObjectReferences(user, query);
  }

  @Get(':id')
  getEmployeeById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.getEmployeeById(user, employeeId);
  }

  @Get(':id/attendance')
  getEmployeeAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Query() query: EmployeeAttendanceQueryDto,
  ): Promise<EmployeeAttendanceResponseDto> {
    return this.employeesService.getEmployeeAttendance(user, employeeId, query);
  }

  @Post()
  createEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.createEmployee(user, payload);
  }

  @Patch(':id')
  updateEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.updateEmployee(user, employeeId, payload);
  }

  @Patch(':id/status')
  changeEmploymentStatus(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: ChangeEmployeeStatusDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.changeEmploymentStatus(user, employeeId, payload);
  }

  @Post(':id/archive')
  archiveEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: EmployeeVersionDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.archiveEmployee(user, employeeId, payload);
  }

  @Post(':id/restore')
  restoreEmployee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: EmployeeVersionDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.restoreEmployee(user, employeeId, payload);
  }

  @Post(':id/delete-permanently')
  deleteEmployeePermanently(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: DeleteEmployeePermanentlyDto,
  ): Promise<{ success: true }> {
    return this.employeesService.deleteEmployeePermanently(
      user,
      employeeId,
      payload,
    );
  }

  @Post(':id/availability')
  addAvailabilityWindow(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: CreateEmployeeAvailabilityDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.addAvailabilityWindow(user, employeeId, payload);
  }

  @Post(':id/substitutions')
  addSubstitution(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: CreateEmployeeSubstitutionDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.addSubstitution(user, employeeId, payload);
  }

  @Patch(':id/availability/:windowId')
  async updateAvailabilityWindow(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Param('windowId') windowId: string,
    @Body() payload: UpdateEmployeeAvailabilityDto,
  ): Promise<EmployeeResponseDto> {
    await this.scheduleService.updateAvailability(user, employeeId, windowId, payload);
    return this.employeesService.getEmployeeById(user, employeeId);
  }

  @Delete(':id/availability/:windowId')
  async deleteAvailabilityWindow(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Param('windowId') windowId: string,
  ): Promise<EmployeeResponseDto> {
    await this.scheduleService.deleteAvailability(user, employeeId, windowId);
    return this.employeesService.getEmployeeById(user, employeeId);
  }

  @Patch(':id/substitutions/:substitutionId')
  async updateSubstitution(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Param('substitutionId') substitutionId: string,
    @Body() payload: UpdateEmployeeSubstitutionDto,
  ): Promise<EmployeeResponseDto> {
    await this.scheduleService.updateSubstitution(user, employeeId, substitutionId, payload);
    return this.employeesService.getEmployeeById(user, employeeId);
  }

  @Post(':id/object-assignments')
  assignEmployeeToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Body() payload: AssignEmployeeToObjectDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.assignEmployeeToObject(user, employeeId, payload);
  }

  @Delete(':id/object-assignments/:objectId')
  removeEmployeeFromObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Param('objectId') objectId: string,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.removeEmployeeFromObject(
      user,
      employeeId,
      objectId,
    );
  }

  @Post(':id/object-assignment-history/:historyId/delete-as-error')
  deleteObjectAssignmentAsError(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') employeeId: string,
    @Param('historyId') historyId: string,
    @Body() payload: DeleteEmployeeAssignmentAsErrorDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.deleteObjectAssignmentAsError(
      user,
      employeeId,
      historyId,
      payload,
    );
  }
}
