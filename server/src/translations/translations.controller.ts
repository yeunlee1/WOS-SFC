// server/src/translations/translations.controller.ts
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslationsService } from './translations.service';
import { SetTranslationDto } from './dto/set-translation.dto';

@Controller('translations')
@UseGuards(AuthGuard('jwt'))
export class TranslationsController {
  constructor(private service: TranslationsService) {}

  @Get(':key')
  get(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Post()
  set(@Body() dto: SetTranslationDto) {
    return this.service.set(dto.cacheKey, dto.translated);
  }
}
