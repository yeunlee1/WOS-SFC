/**
 * DTO Validation 통합 spec
 *
 * 검증 대상:
 *  - main.ts ValidationPipe 옵션 (whitelist, forbidNonWhitelisted, transform)
 *  - 새/강화된 데코레이터:
 *    · CreateAllianceNoticeDto.lang @MaxLength(10)
 *    · CreateBoardPostDto.imageUrls @ArrayMaxSize(10) @IsString({each}) @MaxLength(500, {each})
 *    · CreateRallyDto.endTimeUTC @Max(2_000_000_000_000)
 *    · CreateNoticeDto.source @IsString() (이미 @IsIn 존재)
 *    · LoginDto.nickname @MaxLength(50), LoginDto.password @MaxLength(100)
 *
 * ValidationPipe 옵션은 main.ts와 동일하게 구성한다.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateAllianceNoticeDto } from './alliance-notices/dto/create-alliance-notice.dto';
import { CreateBoardPostDto } from './boards/dto/create-board-post.dto';
import { CreateNoticeDto } from './notices/dto/create-notice.dto';
import { CreateRallyDto } from './rallies/dto/create-rally.dto';
import { SignupDto } from './auth/dto/signup.dto';
import { LoginDto } from './auth/dto/login.dto';

// main.ts와 동일한 ValidationPipe (production 분기는 false로 고정해 에러 메시지 확인)
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  disableErrorMessages: false,
});

const tx = async <T>(metatype: new () => T, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

describe('DTO Validation — main.ts ValidationPipe 옵션 동작', () => {
  // ===========================================================
  // forbidNonWhitelisted
  // ===========================================================
  describe('forbidNonWhitelisted: true', () => {
    it('DTO 외 필드(role) 송신 시 BadRequestException 발생', async () => {
      const payload = {
        nickname: 'tester',
        password: 'password123',
        allianceName: 'KOR',
        language: 'ko',
        serverCode: '101',
        role: 'admin', // 화이트리스트 외 필드 — 클라이언트가 자기 계급을 정할 수 없음
      };
      await expect(tx(SignupDto, payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('SignupDto에서 제거된 필드(name/birthDate) 송신 시 거부', async () => {
      const payload = {
        nickname: 'tester',
        password: 'password123',
        allianceName: 'KOR',
        language: 'ko',
        serverCode: '101',
        birthDate: '2000-01-01', // 제거된 필드
        name: '홍길동',          // 제거된 필드
      };
      await expect(tx(SignupDto, payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('DTO 외 필드가 없으면 정상 통과 (회귀 방지)', async () => {
      const payload = {
        nickname: 'tester',
        password: 'password123',
        allianceName: 'KOR',
        language: 'ko',
        serverCode: '101',
      };
      const out = await tx(SignupDto, payload);
      expect(out).toBeInstanceOf(SignupDto);
    });
  });

  // ===========================================================
  // SignupDto.nickname @Matches — 한글/영문/숫자만, 2~20자
  // ===========================================================
  describe('SignupDto.nickname @Matches (한글/영문/숫자, 2~20자)', () => {
    const base = {
      password: 'password123',
      allianceName: 'KOR',
      language: 'ko',
      serverCode: '101',
    };

    it('영문 닉네임 통과', async () => {
      const out = (await tx(SignupDto, { ...base, nickname: 'tester01' })) as SignupDto;
      expect(out.nickname).toBe('tester01');
    });

    it('한글 닉네임 통과', async () => {
      const out = (await tx(SignupDto, { ...base, nickname: '테스터' })) as SignupDto;
      expect(out.nickname).toBe('테스터');
    });

    it('한글+영문+숫자 혼합 통과', async () => {
      const out = (await tx(SignupDto, { ...base, nickname: '닉네임abc1' })) as SignupDto;
      expect(out.nickname).toBe('닉네임abc1');
    });

    it('특수문자 포함 거부', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'tester!' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('공백 포함 거부', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'test er' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('1자 거부 (MinLength 미만)', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'a' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('21자 거부 (MaxLength 초과)', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'a'.repeat(21) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // 한글 엣지 케이스 — 정규식 [가-힣]는 완성형만 허용
    it('한글 단일 자모(ㄱ) 거부 — 완성형 외 자모 차단', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'ㄱㄴ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('한글 완성형 1자(가) 거부 — MinLength 미만', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: '가' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('한글 모음 분리 표기(ㅎㅏ) 거부 — 자모 결합 불완전', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'ㅎㅏ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('zero-width space 포함 거부 — 보이지 않는 공백 차단', async () => {
      // U+200B 삽입 — 길이 카운트는 통과해도 정규식에서 차단되어야 함
      await expect(
        tx(SignupDto, { ...base, nickname: 'tes​ter' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('이모지 포함 거부', async () => {
      await expect(
        tx(SignupDto, { ...base, nickname: 'tester🚀' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================
  // transform (enableImplicitConversion 제거 후 동작 확인)
  // ===========================================================
  describe('transform: true (enableImplicitConversion 없음)', () => {
    it('숫자 값은 그대로 number로 통과 (CreateRallyDto.endTimeUTC)', async () => {
      const payload = {
        name: 'rally1',
        endTimeUTC: 1_700_000_000_000,
        totalSeconds: 3600,
      };
      const out = (await tx(CreateRallyDto, payload)) as CreateRallyDto;
      expect(out).toBeInstanceOf(CreateRallyDto);
      expect(typeof out.endTimeUTC).toBe('number');
      expect(out.endTimeUTC).toBe(1_700_000_000_000);
      expect(typeof out.totalSeconds).toBe('number');
      expect(out.totalSeconds).toBe(3600);
    });

    it('숫자 문자열 endTimeUTC는 거부 (enableImplicitConversion 제거로 변환 없음)', async () => {
      const payload = {
        name: 'rally1',
        endTimeUTC: '1700000000000',
        totalSeconds: '3600',
      };
      await expect(tx(CreateRallyDto, payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('숫자 password (예: 12345678)는 거부 — enableImplicitConversion 제거로 type confusion 차단', async () => {
      // enableImplicitConversion 제거 후: number → string 변환이 일어나지 않아
      // @IsString() 검증에서 거부된다. bcrypt DoS 벡터 차단.
      const payload = { nickname: 'tester', password: 12345678 as unknown as string };
      await expect(tx(LoginDto, payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ===========================================================
  // CreateAllianceNoticeDto.lang @MaxLength(10)
  // ===========================================================
  describe('CreateAllianceNoticeDto.lang @MaxLength(10)', () => {
    const base = {
      alliance: 'KOR',
      source: 'discord',
      title: 't',
      content: 'c',
    };

    it('lang 10자 통과 (경계값)', async () => {
      const out = (await tx(CreateAllianceNoticeDto, {
        ...base,
        lang: 'a'.repeat(10),
      })) as CreateAllianceNoticeDto;
      expect(out.lang.length).toBe(10);
    });

    it('lang 11자 거부', async () => {
      await expect(
        tx(CreateAllianceNoticeDto, { ...base, lang: 'a'.repeat(11) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================
  // CreateBoardPostDto.imageUrls 강화
  // ===========================================================
  describe('CreateBoardPostDto.imageUrls', () => {
    const base = {
      alliance: 'KOR',
      nickname: 'n',
      userAlliance: 'KOR',
      content: 'c',
    };

    it('imageUrls 10개 통과 (경계값)', async () => {
      const out = (await tx(CreateBoardPostDto, {
        ...base,
        imageUrls: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.png`),
      })) as CreateBoardPostDto;
      expect(out.imageUrls?.length).toBe(10);
    });

    it('imageUrls 11개 거부', async () => {
      await expect(
        tx(CreateBoardPostDto, {
          ...base,
          imageUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('imageUrls 요소 500자 통과 (경계값)', async () => {
      const out = (await tx(CreateBoardPostDto, {
        ...base,
        imageUrls: ['a'.repeat(500)],
      })) as CreateBoardPostDto;
      expect(out.imageUrls?.[0].length).toBe(500);
    });

    it('imageUrls 요소 501자 거부', async () => {
      await expect(
        tx(CreateBoardPostDto, { ...base, imageUrls: ['a'.repeat(501)] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('imageUrls 요소가 number면 거부 (IsString each)', async () => {
      await expect(
        tx(CreateBoardPostDto, { ...base, imageUrls: [123 as unknown as string] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('imageUrls 미지정 정상 통과 (Optional)', async () => {
      const out = (await tx(CreateBoardPostDto, base)) as CreateBoardPostDto;
      expect(out.imageUrls).toBeUndefined();
    });
  });

  // ===========================================================
  // CreateRallyDto.endTimeUTC @Max(2_000_000_000_000)
  // ===========================================================
  describe('CreateRallyDto.endTimeUTC @Max(2_000_000_000_000)', () => {
    it('경계값 2_000_000_000_000 통과', async () => {
      const out = (await tx(CreateRallyDto, {
        name: 'rally',
        endTimeUTC: 2_000_000_000_000,
        totalSeconds: 60,
      })) as CreateRallyDto;
      expect(out.endTimeUTC).toBe(2_000_000_000_000);
    });

    it('2_000_000_000_001 거부', async () => {
      await expect(
        tx(CreateRallyDto, {
          name: 'rally',
          endTimeUTC: 2_000_000_000_001,
          totalSeconds: 60,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================
  // CreateNoticeDto.source @IsString() @IsIn
  // ===========================================================
  describe('CreateNoticeDto.source', () => {
    it('source=discord 정상 통과', async () => {
      const out = (await tx(CreateNoticeDto, {
        source: 'discord',
        title: 't',
        content: 'c',
      })) as CreateNoticeDto;
      expect(out.source).toBe('discord');
    });

    it('source가 IsIn 화이트리스트 외 값(=invalid)이면 거부', async () => {
      await expect(
        tx(CreateNoticeDto, { source: 'twitter', title: 't', content: 'c' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('source가 number면 거부 (IsString)', async () => {
      // enableImplicitConversion 제거 후: number → string 변환 없이 @IsString()에서 직접 거부된다.
      await expect(
        tx(CreateNoticeDto, { source: 123 as unknown as string, title: 't', content: 'c' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================
  // LoginDto MaxLength 경계값 — 2회차 추가
  //   nickname @MaxLength(50), password @MaxLength(100)
  //   security 2회차 리뷰: 회귀 위험 완화용 직접 경계 테스트
  // ===========================================================
  describe('LoginDto @MaxLength 경계값 (2회차 보강)', () => {
    it('nickname 50자 + password 100자 통과 (경계값)', async () => {
      const out = (await tx(LoginDto, {
        nickname: 'a'.repeat(50),
        password: 'b'.repeat(100),
      })) as LoginDto;
      expect(out).toBeInstanceOf(LoginDto);
      expect(out.nickname.length).toBe(50);
      expect(out.password.length).toBe(100);
    });

    it('nickname 51자 거부 (@MaxLength(50) 초과)', async () => {
      await expect(
        tx(LoginDto, { nickname: 'a'.repeat(51), password: 'validpass' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('password 101자 거부 (@MaxLength(100) 초과 — bcrypt DoS 차단)', async () => {
      await expect(
        tx(LoginDto, { nickname: 'tester', password: 'a'.repeat(101) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('password 5자 거부 (@MinLength(6) 미만 — 회귀 방지)', async () => {
      await expect(
        tx(LoginDto, { nickname: 'tester', password: 'a'.repeat(5) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('password 6자 통과 (MinLength 경계 — 회귀 방지)', async () => {
      const out = (await tx(LoginDto, {
        nickname: 'tester',
        password: 'a'.repeat(6),
      })) as LoginDto;
      expect(out.password.length).toBe(6);
    });
  });
});
