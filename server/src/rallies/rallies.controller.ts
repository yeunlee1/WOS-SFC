// server/src/rallies/rallies.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RalliesService } from './rallies.service';

@Controller('rallies')
@UseGuards(AuthGuard('jwt'))
export class RalliesController {
  constructor(private service: RalliesService) {}

  @Post()
  add(@Body() body: { name: string; endTimeUTC: number; totalSeconds: number }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
