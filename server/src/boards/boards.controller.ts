// server/src/boards/boards.controller.ts
import {
  Controller, Post, Delete, Param, Body,
  UseGuards, ParseIntPipe, UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { BoardsService } from './boards.service';
import { CreateBoardPostDto } from './dto/create-board-post.dto';

const UPLOAD_DIR = join(process.cwd(), '..', 'uploads', 'boards');

@Controller('boards')
@UseGuards(AuthGuard('jwt'))
export class BoardsController {
  constructor(private service: BoardsService) {}

  @Post()
  add(@Body() dto: CreateBoardPostDto) {
    return this.service.add(dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
      },
      filename: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${uuidv4()}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new BadRequestException('이미지 파일만 업로드 가능합니다'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 없습니다');
    return { url: `/uploads/boards/${file.filename}` };
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
