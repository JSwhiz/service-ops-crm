// import { Controller, Get } from '@nestjs/common';

// import { HealthResponseDto } from '@/common/dto/health-response.dto';

// @Controller('health')
// export class HealthController {
//   @Get()
//   getHealth(): HealthResponseDto {
//     return {
//       status: 'ok',
//       service: 'backend',
//       timestamp: new Date().toISOString(),
//     };
//   }
// }

import { Controller, Get } from '@nestjs/common';

import { HealthResponseDto } from '../../common/dto/health-response.dto';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }
}
