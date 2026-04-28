/* ════════════════════════════════════════════════════════════
   snow.jsx — Falling snow + grid background canvas
   ════════════════════════════════════════════════════════════ */

const { useEffect, useRef } = React;

function SnowCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let w, h, raf;
    const flakes = [];
    function resize() {
      w = cv.width = window.innerWidth * (window.devicePixelRatio || 1);
      h = cv.height = window.innerHeight * (window.devicePixelRatio || 1);
      cv.style.width = window.innerWidth + 'px';
      cv.style.height = window.innerHeight + 'px';
    }
    function init() {
      flakes.length = 0;
      const count = window.innerWidth < 760 ? 60 : 140;
      for (let i = 0; i < count; i++) {
        flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (0.6 + Math.random() * 1.8) * (window.devicePixelRatio || 1),
          vy: 0.2 + Math.random() * 0.7,
          vx: -0.15 + Math.random() * 0.3,
          alpha: 0.3 + Math.random() * 0.7,
          drift: Math.random() * Math.PI * 2,
          driftSpd: 0.005 + Math.random() * 0.015,
        });
      }
    }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.drift += f.driftSpd;
        f.x += f.vx + Math.sin(f.drift) * 0.3;
        f.y += f.vy;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        if (f.x < -4) f.x = w + 4;
        if (f.x > w + 4) f.x = -4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168, 230, 255, ' + f.alpha + ')';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(124, 220, 255, 0.5)';
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    }
    resize(); init(); tick();
    const onResize = () => { resize(); init(); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={ref} className="snow-canvas" />;
}

window.SnowCanvas = SnowCanvas;
