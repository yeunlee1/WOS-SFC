import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslateService } from './translate.service';

@Controller('translate')
@UseGuards(AuthGuard('jwt'))
export class TranslateController {
  constructor(private service: TranslateService) {}

  @Post()
  async translate(@Body() body: { text: string; targetLang: string }) {
    try {
      const translated = await this.service.translate(body.text, body.targetLang);
      return { translated };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
}
