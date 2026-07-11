// 게시판 이미지 업로드용 multer 옵션을 제공한다.
import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UPLOAD_ROOT } from '../storage-paths';

export const BOARD_UPLOAD_DIR = join(UPLOAD_ROOT, 'boards');

export const BOARD_UPLOAD_EXTENSION_BY_MIME_TYPE: Readonly<
  Record<string, string>
> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export const BOARD_UPLOAD_ALLOWED_MIME_TYPES = Object.keys(
  BOARD_UPLOAD_EXTENSION_BY_MIME_TYPE,
);

export const BOARD_UPLOAD_URL_PATTERN =
  /^\/uploads\/boards\/\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/i;

export const BOARD_UPLOAD_LIMITS: NonNullable<MulterOptions['limits']> = {
  fileSize: 5 * 1024 * 1024,
  files: 1,
  fields: 0,
  parts: 1,
  fieldNameSize: 100,
};

export const BOARD_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      if (!existsSync(BOARD_UPLOAD_DIR)) {
        mkdirSync(BOARD_UPLOAD_DIR, { recursive: true });
      }
      cb(null, BOARD_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = BOARD_UPLOAD_EXTENSION_BY_MIME_TYPE[file.mimetype] ?? '.bin';
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!BOARD_UPLOAD_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new BadRequestException('이미지 파일만 업로드 가능합니다'),
        false,
      );
    }
    cb(null, true);
  },
  limits: BOARD_UPLOAD_LIMITS,
};
