// server/src/rallies/rallies.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RalliesService } from './rallies.service';
import { CreateRallyDto } from './dto/create-rally.dto';

@Controller('rallies')
@UseGuards(AuthGuard('jwt'))
export class RalliesController {
  constructor(private service: RalliesService) {}

  @Post()
  add(@Body() dto: CreateRallyDto) {
    return this.service.add(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
