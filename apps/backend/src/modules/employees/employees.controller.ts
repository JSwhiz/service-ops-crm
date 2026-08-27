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
  EmployeeObjectReferenceDto,
  EmployeePositionReferenceDto,
  ListEmployeeReferencesQueryDto,
} from './dto/list-employee-references-query.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

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
  constructor(private readonly employeesService: EmployeesService) {}

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
}
