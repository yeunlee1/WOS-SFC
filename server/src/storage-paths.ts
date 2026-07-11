// 실행 작업 디렉터리와 무관하게 저장소 기준 런타임 저장 경로를 제공한다.
import { join } from 'path';

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const UPLOAD_ROOT = join(PROJECT_ROOT, 'uploads');
