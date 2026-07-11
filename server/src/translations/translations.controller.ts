// server/src/translations/translations.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslationsService } from './translations.service';

@Controller('translations')
@UseGuards(AuthGuard('jwt'))
export class TranslationsController {
  constructor(private service: TranslationsService) {}

  @Get(':key')
  async get(@Param('key') key: string) {
    return { translated: await this.service.get(key) };
  }
}
