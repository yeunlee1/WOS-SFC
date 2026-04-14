// server/src/translations/translations.controller.ts
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslationsService } from './translations.service';

@Controller('translations')
@UseGuards(AuthGuard('jwt'))
export class TranslationsController {
  constructor(private service: TranslationsService) {}

  @Get(':key')
  get(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Post()
  set(@Body() body: { cacheKey: string; translated: string }) {
    return this.service.set(body.cacheKey, body.translated);
  }
}
