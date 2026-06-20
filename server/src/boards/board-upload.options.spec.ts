// 게시판 이미지 업로드 제한 설정을 검증하는 테스트
import {
  BOARD_UPLOAD_ALLOWED_MIME_TYPES,
  BOARD_UPLOAD_EXTENSION_BY_MIME_TYPE,
  BOARD_UPLOAD_LIMITS,
} from './board-upload.options';

describe('BOARD_UPLOAD_LIMITS', () => {
  it('limits upload requests to one image-only multipart payload', () => {
    expect(BOARD_UPLOAD_LIMITS.fileSize).toBe(10 * 1024 * 1024);
    expect(BOARD_UPLOAD_LIMITS.files).toBe(1);
    expect(BOARD_UPLOAD_LIMITS.fields).toBe(0);
    expect(BOARD_UPLOAD_LIMITS.parts).toBe(1);
    expect(BOARD_UPLOAD_LIMITS.fieldNameSize).toBeLessThanOrEqual(100);
  });

  it('derives stored extensions from accepted image MIME types', () => {
    expect(BOARD_UPLOAD_ALLOWED_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]);
    expect(BOARD_UPLOAD_EXTENSION_BY_MIME_TYPE).toEqual({
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    });
  });
});
