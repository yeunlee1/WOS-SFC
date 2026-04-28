import { useEffect, useRef } from 'react';

/**
 * BlossomCanvas — Spring 테마 전용 벚꽃 파티클 배경.
 *
 * 부모(App.jsx)에서 `theme === 'spring'` 일 때만 마운트해야 함.
 * 다른 테마 cleanup 보장: theme 전환 시 unmount 되어 raf/리스너 정리됨.
 *
 * 모바일/데스크톱 분기:
 *  - innerWidth < 760: 60개
 *  - 그 외: 140개
 *
 * 애니메이션: OS prefers-reduced-motion 설정과 무관하게 항상 raf 루프를 실행한다.
 * spring 벚꽃은 핵심 비주얼 아이덴티티 — 멈추지 않는다.
 */
export default function BlossomCanvas() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    // spring 테마의 벚꽃 애니메이션은 핵심 비주얼 아이덴티티.
    // prefers-reduced-motion OS 설정과 무관하게 항상 raf 루프를 실행한다.
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
      // 꽃잎 수: 모바일 60, 데스크톱 140
      const count = window.innerWidth < 760 ? 60 : 140;
      for (let i = 0; i < count; i++) {
        // 꽃잎 색상: 연분홍 ~ 진분홍 범위
        const hue = 330 + Math.random() * 30; // 330~360 (분홍~장미)
        const sat = 70 + Math.random() * 30;
        const lit = 60 + Math.random() * 25;
        flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          // 꽃잎 크기: 1.2 ~ 3.5 px (눈보다 약간 큰 타원형)
          rx: (1.2 + Math.random() * 2.3) * dpr,
          ry: (0.6 + Math.random() * 1.5) * dpr,
          // 눈보다 약간 느린 낙화 속도
          vy: 0.15 + Math.random() * 0.55,
          vx: -0.2 + Math.random() * 0.4,
          alpha: 0.45 + Math.random() * 0.55,
          rot: Math.random() * Math.PI * 2,
          rotSpd: (Math.random() - 0.5) * 0.04,
          drift: Math.random() * Math.PI * 2,
          driftSpd: 0.004 + Math.random() * 0.012,
          hsl: `${hue.toFixed(0)},${sat.toFixed(0)}%,${lit.toFixed(0)}%`,
        });
      }
    }

    function drawFrame(animate = true) {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        if (animate) {
          f.drift += f.driftSpd;
          f.rot  += f.rotSpd;
          f.x += f.vx + Math.sin(f.drift) * 0.25;
          f.y += f.vy;
          if (f.y > h + 6) { f.y = -6; f.x = Math.random() * w; }
          if (f.x < -6) f.x = w + 6;
          if (f.x > w + 6) f.x = -6;
        }
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.beginPath();
        // 회전된 타원으로 꽃잎 표현
        ctx.ellipse(0, 0, f.rx, f.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${f.hsl},${f.alpha})`;
        ctx.shadowBlur = 6;
        ctx.shadowColor = `hsla(${f.hsl},0.6)`;
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
    }

    function tick() {
      drawFrame(true);
      raf = requestAnimationFrame(tick);
    }

    resize();
    init();
    tick(); // 항상 raf 루프 실행 — spring 벚꽃 애니메이션은 OS reduced-motion 설정과 무관

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

  return <canvas ref={ref} className="blossom-canvas" aria-hidden />;
}
