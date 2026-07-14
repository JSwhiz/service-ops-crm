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
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTaskCompletionsQueryDto } from './dto/list-task-completions-query.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import {
  AddTaskAssigneesDto,
  CompleteTaskAssignmentDto,
  TaskReasonDto,
} from './dto/task-lifecycle.dto';
import { TaskHistoryEventResponseDto } from './dto/task-history-response.dto';
import { TaskCompletionListResponseDto } from './dto/task-completion-response.dto';
import {
  TaskListResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
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
  ): Promise<TaskResponseDto[] | TaskListResponseDto> {
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

  @Patch('tasks/:id')
  updateTask(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.updateTask(user, id, payload);
  }

  @Post('tasks/:id/result')
  submitTaskResult(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: SubmitTaskResultDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.submitResult(user, id, payload);
  }

  @Post('tasks/:id/assignees')
  addAssignees(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: AddTaskAssigneesDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.addAssignees(user, id, payload);
  }

  @Delete('tasks/:id/assignees/:userId')
  removeAssignee(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<TaskResponseDto> {
    return this.tasksService.removeAssignee(user, id, userId);
  }

  @Post('tasks/:id/assignees/me/completion-draft')
  createCompletionDraft(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<{ id: string; workCycle: number }> {
    return this.tasksService.createCompletionDraft(user, id);
  }

  @Post('tasks/:id/assignees/me/complete')
  completeMyAssignment(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CompleteTaskAssignmentDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.completeMyAssignment(user, id, payload);
  }

  @Post('tasks/:id/assignees/me/undo-completion')
  undoMyCompletion(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskResponseDto> {
    return this.tasksService.undoMyCompletion(user, id);
  }

  @Post('tasks/:id/confirm')
  confirmTask(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskResponseDto> {
    return this.tasksService.confirmTask(user, id);
  }

  @Post('tasks/:id/complete-now')
  completeTaskNow(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskResponseDto> {
    return this.tasksService.completeTaskNow(user, id);
  }

  @Post('tasks/:id/return-to-work')
  returnTaskToWork(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.returnTaskToWork(user, id, payload);
  }

  @Post('tasks/:id/reopen')
  reopenTask(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.reopenTask(user, id, payload);
  }

  @Post('tasks/:id/cancel')
  cancelTask(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.cancelTask(user, id, payload);
  }

  @Get('tasks/:id/history')
  listTaskHistory(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskHistoryEventResponseDto[]> {
    return this.tasksService.listTaskHistory(user, id);
  }

  @Get('tasks/:id/completions')
  listTaskCompletions(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Query() query: ListTaskCompletionsQueryDto,
  ): Promise<TaskCompletionListResponseDto> {
    return this.tasksService.listTaskCompletions(user, id, query);
  }

  @Get('objects/:id/tasks')
  listTasksByObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<TaskResponseDto[]> {
    return this.tasksService.listTasksByObject(user, objectId);
  }
}
