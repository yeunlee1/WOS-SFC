import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NoticesService } from './notices.service';

@Controller('notices')
@UseGuards(AuthGuard('jwt'))
export class NoticesController {
  constructor(private service: NoticesService) {}

  @Post()
  add(@Body() body: { source: string; title: string; content: string; authorNick?: string; lang?: string }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
