// TranslateModule 의 provider·export 배선을 실제 Nest 컨테이너로 검증한다 — 단위 spec 의 수동 생성자 호출은 누락을 못 잡는다.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MessageTranslation } from '../chat/message-translation.entity';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { Translation } from '../translations/translation.entity';
import { ChatTranslationService } from './chat-translation.service';
import { TranslateController } from './translate.controller';
import { TranslateModule } from './translate.module';
import { TranslateEngineService } from './translate-engine.service';
import { TranslationQueueService } from './translation-queue.service';

// ChatModule 과 같은 모양 — TranslateModule 을 import 해 ChatGateway 가 ChatTranslationService 를 받는다.
@Module({
  imports: [TranslateModule],
  providers: [
    ChatGateway,
    WsRateLimitService,
    { provide: ChatService, useValue: {} },
    { provide: SocketAuthService, useValue: {} },
  ],
})
class ChatLikeModule {}

describe('TranslateModule 배선', () => {
  it('컨트롤러·채팅 번역 서비스·게이트웨이가 모두 주입된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ OPENAI_API_KEY: 'test', TRANSLATE_MODEL: 'gpt-test', TRANSLATE_GLOBAL_RPM: '7' })],
        }),
        ChatLikeModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Translation))
      .useValue({})
      .overrideProvider(getRepositoryToken(MessageTranslation))
      .useValue({})
      .compile();

    expect(moduleRef.get(TranslateController)).toBeInstanceOf(TranslateController);
    expect(moduleRef.get(ChatTranslationService)).toBeInstanceOf(ChatTranslationService);
    expect(moduleRef.get(ChatGateway)).toBeInstanceOf(ChatGateway);
    expect(moduleRef.get(TranslateEngineService).model).toBe('gpt-test');
    expect(moduleRef.get(TranslationQueueService).rpm).toBe(7);
    await moduleRef.close();
  });
});
