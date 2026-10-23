import { useEffect, useRef } from "react";

const PERIOD = 3200;
const SIZE = 176;
const LINE = "rgb(235,238,245)";
const HOLE = "rgb(30,34,52)";
const GREEN = "rgb(74,222,128)";
const EYE = "rgb(205,215,255)";
const RIM = "rgba(90,120,255,0.55)";

type P = [number, number];
const A: P = [0.24, 0.36];
const B: P = [0.4, 0.66];
const C: P = [0.74, 0.62];

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutBack = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const cubic = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [f(0), f(1)];
};

/** The commit line A → B → C (unit square), sampled into points with their distance along the line */
const samples: { point: P; distance: number }[] = (() => {
  const bend: P = [0.24, 0.5];
  const points: P[] = [];
  for (let i = 0; i <= 10; i++) points.push([A[0], A[1] + ((bend[1] - A[1]) * i) / 10]);
  for (let i = 1; i <= 40; i++) points.push(cubic(bend, [0.24, 0.61], [0.29, 0.66], B, i / 40));
  for (let i = 1; i <= 60; i++) points.push(cubic(B, [0.52, 0.69], [0.62, 0.68], C, i / 60));
  let distance = 0;
  return points.map((point, i) => {
    if (i > 0) distance += Math.hypot(point[0] - points[i - 1][0], point[1] - points[i - 1][1]);
    return { point, distance };
  });
})();
const TOTAL = samples[samples.length - 1].distance;
const B_AT = samples[50].distance / TOTAL;

/**
 * Shown while a repository opens: the app icon's commit line grows while the Gitrochi watches it.
 * The macOS app draws the same picture (Views/Shared/LoadingView.swift).
 */
export function LoadingView({ title, step, hidden }: { title: string; step: string; hidden?: boolean }) {
  return (
    <div className={`loading ${hidden ? "hide" : ""}`}>
      <GitrochiMark />
      <div style={{ textAlign: "center" }}>
        <div className="title">{title}</div>
        <div className="step">{step}</div>
      </div>
    </div>
  );
}

function GitrochiMark() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const s = SIZE;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = s * dpr;
    canvas.height = s * dpr;
    const ctx = canvas.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const p = (u: P): P => [u[0] * s, u[1] * s];

    const draw = (phase: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s, s);
      ctx.globalAlpha = phase < 0.08 ? phase / 0.08 : phase > 0.86 ? Math.max(0, (1 - phase) / 0.14) : 1;

      // The Gitrochi: a dark head with a blue rim light
      ctx.beginPath();
      ctx.arc(0.69 * s, 0.31 * s, 0.25 * s, 0, Math.PI * 2);
      ctx.shadowColor = RIM;
      ctx.shadowBlur = s * 0.07;
      ctx.strokeStyle = "rgba(90,120,255,0.3)";
      ctx.lineWidth = s * 0.012;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgb(15,18,36)";
      ctx.fill();

      // Commit line growing from A to C
      const grow = ease((phase - 0.04) / 0.5);
      const shown = samples.filter((x) => x.distance <= TOTAL * grow);
      const tip = p(shown.length ? shown[shown.length - 1].point : A);
      if (shown.length > 1) {
        ctx.beginPath();
        shown.forEach(({ point }, i) => (i ? ctx.lineTo(...p(point)) : ctx.moveTo(...p(point))));
        ctx.lineWidth = s * 0.06;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = LINE;
        ctx.shadowColor = "rgba(235,238,245,0.35)";
        ctx.shadowBlur = s * 0.04;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Commits pop in as the line reaches them; the last one glows green
      const nodes: [P, number, boolean][] = [
        [A, 0, false],
        [B, B_AT, false],
        [C, 1, true],
      ];
      for (const [center, at, last] of nodes) {
        const appear = Math.min(1, Math.max(0, (grow - at) / 0.1 + (grow >= 1 && at >= 1 ? 1 : 0)));
        if (appear <= 0) continue;
        const r = s * 0.075 * easeOutBack(appear);
        const [x, y] = p(center);
        if (last) {
          ctx.shadowColor = "rgba(74,222,128,0.8)";
          ctx.shadowBlur = s * 0.1;
        }
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
        ctx.fillStyle = last ? "rgb(220,250,230)" : LINE;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, r * 0.55), 0, Math.PI * 2);
        ctx.fillStyle = last ? GREEN : HOLE;
        ctx.fill();
      }

      // Eyes follow the tip of the line and blink once a loop
      const blink = 1 - 0.92 * Math.max(0, 1 - Math.abs(phase - 0.66) / 0.035);
      const eyes: [P, number, number, number][] = [
        [[0.58, 0.26], 0.1, 0.16, -0.2],
        [[0.8, 0.37], 0.16, 0.1, -0.3],
      ];
      for (const [center, w, h, angle] of eyes) {
        const [cx, cy] = p(center);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.scale(1, blink);
        ctx.beginPath();
        ctx.ellipse(0, 0, (w * s) / 2, (h * s) / 2, 0, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(90,120,255,0.7)";
        ctx.shadowBlur = s * 0.05;
        ctx.fillStyle = EYE;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.clip();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const d = Math.max(1, Math.hypot(tip[0] - cx, tip[1] - cy));
        const reach = Math.min(w, h) * s * 0.22;
        ctx.beginPath();
        ctx.ellipse(cx + ((tip[0] - cx) / d) * reach, cy + ((tip[1] - cy) / d) * reach, Math.min(w, h) * s * 0.16, Math.max(w, h) * s * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgb(20,24,60)";
        ctx.fill();
        ctx.restore();
      }
    };

    if (reduce) draw(0.6);
    else {
      const start = performance.now();
      const tick = (t: number) => {
        draw(((t - start) % PERIOD) / PERIOD);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ width: SIZE, height: SIZE }} />;
}
