import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('time')
  getTime(): { utc: number } {
    return { utc: Date.now() };
  }
}
