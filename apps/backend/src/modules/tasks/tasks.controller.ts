import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TasksService } from './tasks.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('tasks')
  listTasks(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListTasksQueryDto,
  ): Promise<TaskResponseDto[]> {
    return this.tasksService.listTasks(user, query);
  }

  @Get('tasks/:id')
  getTask(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskResponseDto> {
    return this.tasksService.getTaskById(user, id);
  }

  @Post('tasks')
  createTask(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.createTask(user, payload);
  }

  @Patch('tasks/:id/status')
  updateTaskStatus(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.updateStatus(user, id, payload);
  }

  @Post('tasks/:id/result')
  submitTaskResult(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: SubmitTaskResultDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.submitResult(user, id, payload);
  }

  @Get('objects/:id/tasks')
  listTasksByObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<TaskResponseDto[]> {
    return this.tasksService.listTasksByObject(user, objectId);
  }
}
