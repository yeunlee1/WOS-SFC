import { useEffect, useRef } from 'react';

/**
 * SnowCanvas — Frost 테마 전용 강설 파티클 배경.
 *
 * 부모(App.jsx)에서 `theme === 'frost'` 일 때만 마운트해야 함.
 * 다른 테마 cleanup 보장: theme 전환 시 unmount 되어 raf/리스너 정리됨.
 *
 * 모바일/데스크톱 분기:
 *  - innerWidth < 760: 80개
 *  - 그 외: 180개
 *
 * 애니메이션: OS prefers-reduced-motion 설정과 무관하게 항상 raf 루프를 실행한다.
 * frost 강설은 핵심 비주얼 아이덴티티 — 멈추지 않는다.
 */
export default function SnowCanvas() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    // frost 테마의 강설 애니메이션은 핵심 비주얼 아이덴티티.
    // prefers-reduced-motion OS 설정과 무관하게 항상 raf 루프를 실행한다.
    // (CSS 측 .snow-canvas { display: none } 으로 완전히 숨기고 싶을 때는 별도 대응)
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let w, h, raf;
    const flakes = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = cv.width = window.innerWidth * dpr;
      h = cv.height = window.innerHeight * dpr;
      cv.style.width = window.innerWidth + 'px';
      cv.style.height = window.innerHeight + 'px';
    }

    function init() {
      flakes.length = 0;
      const dpr = window.devicePixelRatio || 1;
      // 눈송이 수: 모바일 80, 데스크톱 180 — frost 테마의 시각 인상을 강하게 하기 위해 강화.
      const count = window.innerWidth < 760 ? 80 : 180;
      for (let i = 0; i < count; i++) {
        flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          // 눈송이 크기 강화: 0.8 ~ 3.0 px (이전 0.6 ~ 2.4)
          r: (0.8 + Math.random() * 2.2) * dpr,
          vy: 0.2 + Math.random() * 0.7,
          vx: -0.15 + Math.random() * 0.3,
          // 알파 강화: 0.5 ~ 1.0 (이전 0.3 ~ 1.0) — 진하게.
          alpha: 0.5 + Math.random() * 0.5,
          drift: Math.random() * Math.PI * 2,
          driftSpd: 0.005 + Math.random() * 0.015,
        });
      }
    }

    function drawFrame(animate = true) {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        if (animate) {
          f.drift += f.driftSpd;
          f.x += f.vx + Math.sin(f.drift) * 0.3;
          f.y += f.vy;
          if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
          if (f.x < -4) f.x = w + 4;
          if (f.x > w + 4) f.x = -4;
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168, 230, 255, ' + f.alpha + ')';
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(124, 220, 255, 0.7)';
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function tick() {
      drawFrame(true);
      raf = requestAnimationFrame(tick);
    }

    resize();
    init();
    tick(); // 항상 raf 루프 실행 — frost 강설 애니메이션은 OS reduced-motion 설정과 무관

    function onResize() {
      resize();
      init();
    }
    window.addEventListener('resize', onResize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="snow-canvas" aria-hidden />;
}
