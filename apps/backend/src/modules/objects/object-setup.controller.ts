import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PatchObjectSetupDto } from './dto/object-setup.dto';
import { ObjectSetupService, type ObjectSetupActor } from './object-setup.service';

@UseGuards(JwtAuthGuard)
@Controller('objects/:id/setup')
export class ObjectSetupController {
  constructor(private readonly setup: ObjectSetupService) {}

  @Get()
  get(@CurrentUser() user: ObjectSetupActor, @Param('id') id: string) {
    return this.setup.getSetup(user, id);
  }

  @Patch()
  patch(@CurrentUser() user: ObjectSetupActor, @Param('id') id: string, @Body() input: PatchObjectSetupDto) {
    return this.setup.patchSetup(user, id, input);
  }
}
