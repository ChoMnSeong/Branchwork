import { useEffect, useRef } from "react";

const PERIOD = 2600;
const MAIN = "rgb(61,214,232)";
const FEATURE = "rgb(255,138,61)";
const TOPIC = "rgb(156,224,92)";

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
/** 선 진행도가 at 을 지난 뒤 점이 나타나는 정도(0…1, 약 0.12 동안) */
const at = (progress: number, a: number) => Math.min(1, Math.max(0, (progress - a) / 0.12 + (progress >= 1 && a >= 0.99 ? 1 : 0)));

/**
 * 저장소를 여는 동안 보이는 로딩 화면(맥 버전과 같은 그림).
 * 앱 아이콘과 같은 세 갈래 브랜치가 아래에서 위로 자라고, 곁가지가 갈라졌다 다시 합쳐지며,
 * 선이 지나갈 때 커밋 점이 톡 튀어나온 뒤 사라지기를 반복한다.
 */
export function LoadingView({ title, step, hidden }: { title: string; step: string; hidden?: boolean }) {
  return (
    <div className={`loading ${hidden ? "hide" : ""}`}>
      <BranchMark />
      <div style={{ textAlign: "center" }}>
        <div className="title">{title}</div>
        <div className="step">{step}</div>
      </div>
    </div>
  );
}

function BranchMark() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const w = 150,
      h = 176;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const p = (x: number, y: number): [number, number] => [x * w, y * h];
    const lw = Math.min(w, h) * 0.06;
    const r = Math.min(w, h) * 0.058;

    const main = new Path2D();
    main.moveTo(...p(0.3, 0.96));
    main.lineTo(...p(0.3, 0.04));
    const feature = new Path2D();
    feature.moveTo(...p(0.3, 0.8));
    feature.bezierCurveTo(...p(0.3, 0.68), ...p(0.64, 0.7), ...p(0.64, 0.58));
    feature.lineTo(...p(0.64, 0.38));
    feature.bezierCurveTo(...p(0.64, 0.26), ...p(0.3, 0.28), ...p(0.3, 0.16));
    const topic = new Path2D();
    topic.moveTo(...p(0.64, 0.52));
    topic.bezierCurveTo(...p(0.64, 0.4), ...p(0.9, 0.42), ...p(0.9, 0.3));
    topic.lineTo(...p(0.9, 0.22));
    // 선 길이(대략) — 대시 오프셋으로 자라는 모습을 낸다
    const lengths = [h * 0.92, h * 1.15, h * 0.5];

    const draw = (phase: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mainP = ease(phase / 0.42);
      const featureP = ease((phase - 0.18) / 0.42);
      const topicP = ease((phase - 0.42) / 0.28);
      ctx.globalAlpha = phase < 0.05 ? phase / 0.05 : phase > 0.86 ? Math.max(0, (1 - phase) / 0.14) : 1;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const lines: [Path2D, string, number, number][] = [
        [main, MAIN, mainP, lengths[0]],
        [feature, FEATURE, featureP, lengths[1]],
        [topic, TOPIC, topicP, lengths[2]],
      ];
      for (const [path, color, prog, len] of lines) {
        if (prog <= 0) continue;
        ctx.setLineDash([len * prog, len * 2]);
        ctx.shadowColor = color;
        ctx.shadowBlur = lw * 1.4;
        ctx.strokeStyle = color;
        ctx.stroke(path);
      }
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const nodes: [[number, number], string, number][] = [
        [p(0.3, 0.9), MAIN, at(mainP, 0.065)],
        [p(0.3, 0.62), MAIN, at(mainP, 0.37)],
        [p(0.3, 0.34), MAIN, at(mainP, 0.67)],
        [p(0.3, 0.08), MAIN, at(mainP, 0.96)],
        [p(0.64, 0.54), FEATURE, at(featureP, 0.4)],
        [p(0.64, 0.4), FEATURE, at(featureP, 0.58)],
        [p(0.9, 0.22), TOPIC, at(topicP, 1.0)],
      ];
      for (const [[cx, cy], color, appear] of nodes) {
        if (appear <= 0) continue;
        const rr = r * easeOutBack(appear);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0, rr), 0, Math.PI * 2);
        ctx.fillStyle = "rgb(247,247,247)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0, rr - lw * 0.18), 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw * 0.42;
        ctx.stroke();
        if (appear < 1) {
          ctx.beginPath();
          ctx.arc(cx, cy, r * (1 + appear * 1.6), 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.globalAlpha *= 1;
          ctx.lineWidth = 1.5;
          const a = ctx.globalAlpha;
          ctx.globalAlpha = a * 0.5 * (1 - appear);
          ctx.stroke();
          ctx.globalAlpha = a;
        }
      }
    };
    if (reduce) draw(0.7);
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
  return <canvas ref={ref} style={{ width: 150, height: 176 }} />;
}
