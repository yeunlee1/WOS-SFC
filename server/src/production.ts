// 프로덕션 실행 전에 보안 관련 NODE_ENV 분기를 강제로 활성화한다.
process.env.NODE_ENV = 'production';

void import('./main.js');
