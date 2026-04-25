import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslateService } from './translate.service';
import { TranslateRequestDto } from './dto/translate-request.dto';

@Controller('translate')
@UseGuards(AuthGuard('jwt'))
export class TranslateController {
  constructor(private service: TranslateService) {}

  @Post()
  async translate(@Body() dto: TranslateRequestDto) {
    try {
      const translated = await this.service.translate(dto.text, dto.targetLang);
      return { translated };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
}
