import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfig {
  constructor(private readonly configService: ConfigService) {}

  get backendPort(): number {
    return this.configService.get<number>('app.backendPort', 4000);
  }

  get appName(): string {
    return this.configService.get<string>('app.name', 'Service Ops CRM');
  }

  get nodeEnv(): string {
    return this.configService.get<string>('app.nodeEnv', 'development');
  }
}
