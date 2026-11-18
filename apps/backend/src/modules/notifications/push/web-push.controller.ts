import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { REFRESH_TOKEN_COOKIE } from '../../auth/constants/auth.constants';
import { getCookieValue } from '../../auth/utils/auth-cookie.util';
import { ConnectWebPushDto, PushEndpointDto } from './web-push.dto';
import { WebPushOriginGuard } from './web-push-origin.guard';
import { WebPushService } from './web-push.service';

// Refresh cookie is scoped to /api/v1/auth. No change to existing cookie scope.
@UseGuards(JwtAuthGuard, WebPushOriginGuard)
@Controller('auth/push')
export class WebPushController {
  constructor(private readonly push: WebPushService) {}
  @Get('config') configuration() { return this.push.configuration(); }
  @Post('subscriptions') connect(@CurrentUser() user: { id: string }, @Req() req: Request, @Body() dto: ConnectWebPushDto) {
    return this.push.connect(user.id, getCookieValue(req.headers.cookie, REFRESH_TOKEN_COOKIE), dto);
  }
  @Post('status') status(@CurrentUser() user: { id: string }, @Body() dto: PushEndpointDto) { return this.push.status(user.id, dto.endpoint); }
  @Post('subscriptions/:id/disconnect') disconnect(@CurrentUser() user: { id: string }, @Param('id', new ParseUUIDPipe()) id: string) { return this.push.disconnect(user.id, id); }
  @Post('subscriptions/:id/test') test(@CurrentUser() user: { id: string }, @Param('id', new ParseUUIDPipe()) id: string) { return this.push.test(user.id, id); }
  @Get('open/:id') open(@CurrentUser() user: { id: string }, @Param('id', new ParseUUIDPipe()) id: string) { return this.push.open(user.id, id); }
}
