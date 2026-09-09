// 번역 캐시 테이블 모듈. 조회 엔드포인트(GET /translations/:key)는 웹이 부르지 않아 제거했다(C-12).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Translation } from './translation.entity';
import { TranslationsService } from './translations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Translation])],
  providers: [TranslationsService],
  exports: [TranslationsService],
})
export class TranslationsModule {}
