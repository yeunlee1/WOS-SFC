// server/src/boards/boards.controller.ts
import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { BoardsService } from './boards.service';
import { CreateBoardPostDto } from './dto/create-board-post.dto';
import { BOARD_UPLOAD_OPTIONS } from './board-upload.options';
import { User } from '../users/users.entity';
import { BoardUploadRateGuard } from './board-upload-rate.guard';
import { BoardUploadQuotaInterceptor } from './board-upload-quota.interceptor';

@Controller('boards')
@UseGuards(AuthGuard('jwt'))
export class BoardsController {
  constructor(private service: BoardsService) {}

  @Post()
  add(@Req() req: Request & { user: User }, @Body() dto: CreateBoardPostDto) {
    return this.service.add(req.user, dto);
  }

  @Post('upload')
  @UseGuards(BoardUploadRateGuard)
  @UseInterceptors(
    BoardUploadQuotaInterceptor,
    FileInterceptor('file', BOARD_UPLOAD_OPTIONS),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 없습니다');
    return { url: `/uploads/boards/${file.filename}` };
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: User },
  ) {
    return this.service.remove(id, req.user);
  }
}
