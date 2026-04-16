import 'reflect-metadata';

import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await configureApp(app);
  await app.listen(0);

  const address = app.getHttpServer().address();
  const port =
    typeof address === 'string' ? new URL(address).port : String(address.port);

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}
