import { describe, expect, it } from "vitest";
// 폴더 구조 규칙(Feature-Sliced Design). 어기면 어느 파일의 어느 import 가 문제인지 그대로 보여 준다.
//
//   app → pages → widgets → features → entities → shared   (왼쪽이 위 계층)
//
// - 위 계층은 아래 계층만 가져온다. 같은 계층의 다른 조각은 가져오지 않는다(엔티티끼리, shared 세그먼트끼리는 허용).
// - 다른 조각은 그 조각의 index.ts(공개 API)로만 가져온다: "@/widgets/sidebar", "@/shared/ui".
// - 같은 조각 안에서는 상대 경로로 가져오고, 상대 경로로 조각 밖을 넘보지 않는다.
// - index.ts 는 쓰는 이름만 밝혀 다시 내보낸다(export * 금지, 다른 코드 금지).
// - 조각 안 파일은 세그먼트 폴더(ui·model·api·lib·config)에 둔다.

const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const SEGMENTS = ["ui", "model", "api", "lib", "config"];
const APP_ENTRIES = ["main.tsx", "start.tsx", "selftest.ts"];
const APP_SEGMENTS = ["ui", "lib", "styles"];
/** 같은 계층 안에서도 서로 가져와도 되는 계층 */
const SAME_LAYER_OK = ["entities", "shared"];

const files = Object.keys(sources).map((p) => p.slice("/src/".length));
const fileSet = new Set(files);

const layerOf = (p: string) => p.split("/")[0];
/** app 은 통째로 한 조각, shared 는 세그먼트가 조각 */
const sliceOf = (p: string) => (layerOf(p) === "app" ? "app" : p.split("/").slice(0, 2).join("/"));
const isIndex = (p: string) => /^[^/]+\/[^/]+\/index\.ts$/.test(p);

function normalize(parts: string[]) {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return out.join("/");
}

/** import 경로 → src 기준 경로. 외부 패키지면 null */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = normalize([...from.split("/").slice(0, -1), ...spec.split("/")]);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (fileSet.has(c)) return c;
  return base; // 자산(png 등)
}

interface Import {
  from: string;
  spec: string;
  target: string;
}

const PATTERNS = [/^(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/gm, /^import\s*["']([^"']+)["']/gm, /\bimport\(\s*["']([^"']+)["']\s*\)/g];

const imports: Import[] = files.flatMap((from) =>
  PATTERNS.flatMap((re) => [...sources[`/src/${from}`].matchAll(re)].map((m) => m[1])).flatMap((spec) => {
    const target = resolve(from, spec);
    return target ? [{ from, spec, target }] : [];
  }),
);

const show = (i: Import) => `${i.from} → "${i.spec}"`;

describe("폴더 구조(FSD)", () => {
  it("import 를 읽어 낸다", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(imports.length).toBeGreaterThan(300);
  });

  it("모든 소스는 계층 폴더 안에 있다", () => {
    expect(files.filter((p) => !LAYERS.includes(layerOf(p)))).toEqual([]);
  });

  it("조각 이름은 케밥 표기", () => {
    const names = new Set(files.filter((p) => layerOf(p) !== "app").map((p) => p.split("/")[1]));
    expect([...names].filter((n) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n))).toEqual([]);
  });

  it("위 계층이나 같은 계층의 다른 조각을 가져오지 않는다", () => {
    const bad = imports.filter((i) => {
      const a = LAYERS.indexOf(layerOf(i.from));
      const b = LAYERS.indexOf(layerOf(i.target));
      if (b > a) return false;
      if (b === a) return sliceOf(i.from) !== sliceOf(i.target) && !SAME_LAYER_OK.includes(layerOf(i.from));
      return true;
    });
    expect(bad.map(show)).toEqual([]);
  });

  it("다른 조각은 공개 API(index.ts)로만 가져온다", () => {
    const bad = imports.filter((i) => {
      if (sliceOf(i.from) === sliceOf(i.target)) return false;
      if (!fileSet.has(i.target)) return !i.spec.startsWith("@/shared/assets/"); // 자산은 파일 그대로
      return i.spec !== `@/${sliceOf(i.target)}`;
    });
    expect(bad.map(show)).toEqual([]);
  });

  it("같은 조각 안에서는 상대 경로로, 자기 index.ts 는 거치지 않는다", () => {
    const bad = imports.filter((i) => sliceOf(i.from) === sliceOf(i.target) && (!i.spec.startsWith(".") || (isIndex(i.target) && !isIndex(i.from))));
    expect(bad.map(show)).toEqual([]);
  });

  it("상대 경로로 조각 밖을 가져오지 않는다", () => {
    const bad = imports.filter((i) => i.spec.startsWith(".") && sliceOf(i.from) !== sliceOf(i.target));
    expect(bad.map(show)).toEqual([]);
  });

  it("index.ts 는 이름을 밝혀 다시 내보내기만 한다", () => {
    const bad = files
      .filter(isIndex)
      .flatMap((p) =>
        sources[`/src/${p}`]
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.startsWith("//") && !/^export (type )?\{ [^}]+ \} from "\.\/[^"]+";$/.test(line))
          .map((line) => `${p}: ${line}`),
      );
    expect(bad).toEqual([]);
  });

  it("다른 조각이 쓰는 조각에는 index.ts 가 있다", () => {
    const used = new Set(imports.filter((i) => sliceOf(i.from) !== sliceOf(i.target) && fileSet.has(i.target)).map((i) => sliceOf(i.target)));
    expect([...used].filter((s) => s !== "app" && !fileSet.has(`${s}/index.ts`))).toEqual([]);
  });

  it("조각 안 파일은 세그먼트 폴더에 있다", () => {
    const bad = files.filter((p) => {
      const parts = p.split("/");
      if (parts[0] === "app") return parts.length === 2 ? !APP_ENTRIES.includes(parts[1]) : !APP_SEGMENTS.includes(parts[1]);
      if (parts[0] === "shared") return parts.length < 3;
      if (parts.length === 3) return parts[2] !== "index.ts";
      return !SEGMENTS.includes(parts[2]);
    });
    expect(bad).toEqual([]);
  });

  it("조각 사이에 순환 참조가 없다", () => {
    const edges = new Map<string, Set<string>>();
    for (const i of imports) {
      const a = sliceOf(i.from);
      const b = sliceOf(i.target);
      if (a !== b && fileSet.has(i.target)) edges.set(a, (edges.get(a) ?? new Set()).add(b));
    }
    const cycles: string[] = [];
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];
    const visit = (n: string) => {
      state.set(n, "visiting");
      stack.push(n);
      for (const m of edges.get(n) ?? []) {
        if (state.get(m) === "visiting") cycles.push([...stack.slice(stack.indexOf(m)), m].join(" → "));
        else if (!state.has(m)) visit(m);
      }
      stack.pop();
      state.set(n, "done");
    };
    for (const n of edges.keys()) if (!state.has(n)) visit(n);
    expect(cycles).toEqual([]);
  });
});
