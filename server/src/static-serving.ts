// 웹 빌드(web/dist)와 업로드 폴더(/uploads)를 서빙하는 ServeStaticModule 등록 목록.
import { DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { UPLOAD_ROOT } from './storage-paths';

export const WEB_DIST_ROOT = join(__dirname, '..', '..', 'web', 'dist');

/** API 라우트 접두어. web/dist 의 index.html 폴백이 이 경로들을 가로채지 않게 제외한다. */
export const STATIC_EXCLUDED_ROUTES = [
  '/auth/*path',
  '/notices/*path',
  '/rallies/*path',
  '/members/*path',
  '/boards/*path',
  '/translations/*path',
  '/users/*path',
  '/translate/*path',
  '/tts-audio/*path',
  '/admin/*path',
  '/alliance-notices/*path',
  '/me/*path',
  '/rally-groups/*path',
  '/operation-boards/*path',
  '/time',
  '/socket.io/*path',
  '/uploads/*path',
];

/**
 * 순서가 중요하다 — 업로드 서빙을 먼저 등록한다.
 *
 * web/dist 쪽은 fallthrough:false 라 자기 폴더에 없는 경로를 즉시 404 로 끝낸다.
 * exclude 목록은 index.html 폴백에만 적용되고 express.static 미들웨어에는 적용되지
 * 않으므로, web/dist 가 먼저 오면 /uploads/x.png 가 web/dist/uploads/x.png 로 해석돼
 * 업로드 이미지와 작전판 배경이 전부 404 였다. 업로드 모듈은 fallthrough 기본값(true)이라
 * 없는 파일은 web/dist 모듈로 넘어가 404 가 된다.
 */
export function staticServingModules(
  options: { webDistRoot?: string; uploadRoot?: string } = {},
): DynamicModule[] {
  const webDistRoot = options.webDistRoot ?? WEB_DIST_ROOT;
  const uploadRoot = options.uploadRoot ?? UPLOAD_ROOT;
  return [
    ServeStaticModule.forRoot({
      rootPath: uploadRoot,
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
    }),
    ServeStaticModule.forRoot({
      rootPath: webDistRoot,
      exclude: STATIC_EXCLUDED_ROUTES,
      serveStaticOptions: { fallthrough: false },
    }),
  ];
}
