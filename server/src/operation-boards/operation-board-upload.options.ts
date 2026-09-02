// 작전판 배경 이미지 업로드용 multer 옵션을 제공한다.
import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UPLOAD_ROOT } from '../storage-paths';

export const OPERATION_BOARD_BACKGROUND_DIR = join(
  UPLOAD_ROOT,
  'operation-boards',
);

export const OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE: Readonly<
  Record<string, string>
> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES = Object.keys(
  OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE,
);

// 업로더가 만드는 파일명 규칙. URL 패턴과 파일명 패턴이 따로 놀면 삭제 판정이
// 어긋나므로 한 소스에서 두 패턴을 함께 만든다.
const OPERATION_BOARD_BACKGROUND_FILE_NAME_SOURCE = String.raw`\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)`;

export const OPERATION_BOARD_BACKGROUND_URL_PREFIX =
  '/uploads/operation-boards/';

export const OPERATION_BOARD_BACKGROUND_FILE_NAME_PATTERN = new RegExp(
  `^${OPERATION_BOARD_BACKGROUND_FILE_NAME_SOURCE}$`,
  'i',
);

export const OPERATION_BOARD_BACKGROUND_URL_PATTERN = new RegExp(
  `^${OPERATION_BOARD_BACKGROUND_URL_PREFIX}${OPERATION_BOARD_BACKGROUND_FILE_NAME_SOURCE}$`,
  'i',
);

export function isOperationBoardBackgroundUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    OPERATION_BOARD_BACKGROUND_URL_PATTERN.test(value)
  );
}

export const OPERATION_BOARD_BACKGROUND_LIMITS: NonNullable<
  MulterOptions['limits']
> = {
  fileSize: 8 * 1024 * 1024,
  files: 1,
  fields: 0,
  parts: 1,
  fieldNameSize: 100,
};

export const OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      if (!existsSync(OPERATION_BOARD_BACKGROUND_DIR)) {
        mkdirSync(OPERATION_BOARD_BACKGROUND_DIR, { recursive: true });
      }
      cb(null, OPERATION_BOARD_BACKGROUND_DIR);
    },
    filename: (req, file, cb) => {
      const ext =
        OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE[file.mimetype] ??
        '.bin';
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (
      !OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      return cb(
        new BadRequestException('이미지 파일만 업로드 가능합니다'),
        false,
      );
    }
    cb(null, true);
  },
  limits: OPERATION_BOARD_BACKGROUND_LIMITS,
};
