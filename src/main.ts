import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  /**
   * Global validation pipe applied to all incoming requests:
   * - whitelist: strips properties not defined in the DTO
   * - forbidNonWhitelisted: rejects requests with unknown properties (400)
   * - transform: automatically converts primitive types to their DTO-declared types
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(3000);
}
bootstrap();
