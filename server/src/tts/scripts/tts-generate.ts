/**
 * TTS 파일 사전 생성 스크립트
 *
 * 실행:  cd server && npm run tts:generate
 *
 * 처음 한 번만 실행하면 이후 서버 재시작 시 Google TTS API를 전혀 호출하지 않는다.
 * 생성 위치: server/tts-cache/{lang}-{key}.mp3
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { LANGS, GOOGLE_VOICES, PHRASES, TTS_PREGEN_MAX } from '../tts.constants';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const API_KEY  = process.env.GOOGLE_TTS_API_KEY || '';
const CACHE_DIR = process.env.TTS_CACHE_DIR
  || path.join(process.cwd(), 'tts-cache');

if (!API_KEY) {
  console.error('❌  GOOGLE_TTS_API_KEY가 .env에 없습니다.');
  process.exit(1);
}

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Google TTS 호출 ────────────────────────────────────────────────────────
async function fetchAudio(lang: string, key: string, text: string): Promise<Buffer> {
  const voice = GOOGLE_VOICES[lang] ?? GOOGLE_VOICES['ko'];
  const isNumber = /^\d+$/.test(key);
  const input = isNumber
    ? { ssml: `<speak><say-as interpret-as="cardinal">${text}</say-as></speak>` }
    : { text };

  const res = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`,
    {
      input,
      voice: { languageCode: voice.languageCode, name: voice.name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.5 },
    },
    { timeout: 15000 },
  );
  return Buffer.from(res.data.audioContent as string, 'base64');
}

// ── 단일 파일 생성 (이미 있으면 스킵) ─────────────────────────────────────
async function ensureFile(lang: string, key: string, text: string): Promise<'skipped' | 'created'> {
  const fp = path.join(CACHE_DIR, `${lang}-${key}.mp3`);
  const exists = await fsPromises.access(fp).then(() => true).catch(() => false);
  if (exists) return 'skipped';

  const tmpFp = `${fp}.tmp`;
  try {
    const buf = await fetchAudio(lang, key, text);
    await fsPromises.writeFile(tmpFp, buf);
    await fsPromises.rename(tmpFp, fp);
    return 'created';
  } catch (e) {
    await fsPromises.unlink(tmpFp).catch(() => {});
    throw e;
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main() {
  // 생성할 항목 목록 조립
  type Item = { lang: string; key: string; text: string };
  const items: Item[] = [];

  for (const lang of LANGS) {
    // 문구
    for (const [key, map] of Object.entries(PHRASES)) {
      items.push({ lang, key, text: map[lang] || map['en'] });
    }
    // 숫자 1~TTS_PREGEN_MAX
    for (let i = 1; i <= TTS_PREGEN_MAX; i++) {
      items.push({ lang, key: String(i), text: String(i) });
    }
  }

  const total = items.length;
  console.log(`\n🎙  TTS 파일 생성 시작`);
  console.log(`   대상: ${LANGS.join(', ')} × (문구 ${Object.keys(PHRASES).length}개 + 숫자 1~${TTS_PREGEN_MAX})`);
  console.log(`   총 ${total}개 파일 → ${CACHE_DIR}\n`);

  let created = 0;
  let skipped = 0;
  let failed  = 0;

  // 동시 3개 제한 (API 과부하 방지)
  const CONCURRENCY = 3;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      try {
        const result = await ensureFile(item.lang, item.key, item.text);
        if (result === 'created') {
          created++;
          const done = created + skipped + failed;
          process.stdout.write(`\r   진행: ${done}/${total} (생성 ${created} / 스킵 ${skipped} / 실패 ${failed})`);
        } else {
          skipped++;
        }
      } catch (e) {
        failed++;
        console.error(`\n   ❌  실패 [${item.lang}/${item.key}]: ${(e as Error).message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const done = created + skipped + failed;
  process.stdout.write(`\r   진행: ${done}/${total} (생성 ${created} / 스킵 ${skipped} / 실패 ${failed})\n\n`);

  if (failed > 0) {
    console.log(`⚠️   ${failed}개 실패. 재실행하면 성공한 파일은 스킵되고 실패한 것만 재시도합니다.`);
  } else {
    console.log(`✅  완료! 이제 서버를 재시작하면 API 호출 없이 바로 음성이 재생됩니다.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
