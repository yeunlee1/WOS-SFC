// 경로에 따라 기존 앱(main)과 동화 버전(story) 중 무엇을 띄울지 정한다.
export function resolveEntry(pathname) {
  return pathname === '/story' || pathname.startsWith('/story/')
    ? 'story'
    : 'main';
}
