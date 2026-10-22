
import type { CIInput } from "./models";

/** 워크플로 입력값·파이프라인 변수를 읽을 만큼만 하는 YAML(블록 맵·목록·[a, b]·따옴표·| > 여러 줄 글) */
export type YNode = { kind: "scalar"; value: string } | { kind: "map"; pairs: [string, YNode][] } | { kind: "list"; items: YNode[] };

interface YLine {
  indent: number;
  text: string;
  raw: string;
  blank: boolean;
}

const scalar = (value: string): YNode => ({ kind: "scalar", value });
export const yget = (n: YNode | undefined, key: string): YNode | undefined => (n?.kind === "map" ? n.pairs.find(([k]) => k === key)?.[1] : undefined);
export const ystr = (n: YNode | undefined): string | undefined => (n?.kind === "scalar" ? n.value : undefined);
const ypairs = (n: YNode | undefined): [string, YNode][] => (n?.kind === "map" ? n.pairs : []);
const yitems = (n: YNode | undefined): YNode[] => (n?.kind === "list" ? n.items : []);

function stripComment(s: string): string {
  let quote: string | null = null;
  let prev = " ";
  for (let n = 0; n < s.length; n++) {
    const c = s[n];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (prev === " " || prev === "\t" || n === 0)) return s.slice(0, n);
    prev = c;
  }
  return s;
}

const isItem = (t: string) => t === "-" || t.startsWith("- ");

/** "key: value" → [key, value]. 값이 없으면 value 는 빈 문자열. */
function splitKey(t: string): [string, string] | null {
  let quote: string | null = null;
  for (let n = 0; n < t.length; n++) {
    const c = t[n];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if ((c === "'" || c === '"') && n === 0) {
      quote = c;
      continue;
    }
    if (c === ":" && (n === t.length - 1 || t[n + 1] === " ")) {
      return [unquote(t.slice(0, n).trim()), n === t.length - 1 ? "" : t.slice(n + 1).trim()];
    }
  }
  return null;
}

export function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return s;
}

function splitFlow(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === ",") {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function scalarNode(v: string): YNode {
  if (v.startsWith("[") && v.endsWith("]")) return { kind: "list", items: splitFlow(v.slice(1, -1)).map((x) => scalar(unquote(x))) };
  if (v.startsWith("{") && v.endsWith("}")) {
    return {
      kind: "map",
      pairs: splitFlow(v.slice(1, -1)).map((part): [string, YNode] => {
        const kv = splitKey(part);
        return kv ? [kv[0], scalar(unquote(kv[1]))] : [unquote(part), scalar("")];
      }),
    };
  }
  return scalar(unquote(v));
}

export function parseYAML(text: string): YNode {
  const lines: YLine[] = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((r) => {
      const raw = r.replace(/\t/g, "  ");
      const trimmed = stripComment(raw).trim();
      const indent = raw.length - raw.replace(/^ +/, "").length;
      return { indent, text: trimmed, raw, blank: !trimmed || trimmed === "---" };
    });
  const pos = { i: 0 };
  const skipBlank = () => {
    while (pos.i < lines.length && lines[pos.i].blank) pos.i++;
  };

  const block = (indent: number): YNode => (isItem(lines[pos.i].text) ? list(indent) : map(indent));

  const map = (indent: number): YNode => {
    const pairs: [string, YNode][] = [];
    while (pos.i < lines.length) {
      const l = lines[pos.i];
      if (l.blank) {
        pos.i++;
        continue;
      }
      if (l.indent < indent || (l.indent === indent && isItem(l.text))) break;
      if (l.indent > indent) {
        pos.i++; // 예상 밖의 들여쓰기는 건너뜀
        continue;
      }
      const kv = splitKey(l.text);
      pos.i++;
      if (!kv) continue;
      pairs.push([kv[0], valueNode(kv[1], indent)]);
    }
    return { kind: "map", pairs };
  };

  const list = (indent: number): YNode => {
    const items: YNode[] = [];
    while (pos.i < lines.length) {
      const l = lines[pos.i];
      if (l.blank) {
        pos.i++;
        continue;
      }
      if (l.indent !== indent || !isItem(l.text)) {
        if (l.indent > indent) {
          pos.i++;
          continue;
        }
        break;
      }
      const rest = l.text.slice(1).trim();
      if (!rest) {
        pos.i++;
        skipBlank();
        if (pos.i < lines.length && lines[pos.i].indent > indent) items.push(block(lines[pos.i].indent));
        else items.push(scalar(""));
      } else if (splitKey(rest) && !rest.startsWith("[") && !rest.startsWith("{")) {
        // "- key: value" 로 시작하는 맵: 그 줄을 맵의 첫 줄로 다시 읽는다
        const inner = indent + (l.text.length - rest.length);
        lines[pos.i] = { indent: inner, text: rest, raw: l.raw, blank: false };
        items.push(map(inner));
      } else {
        pos.i++;
        items.push(scalarNode(rest));
      }
    }
    return { kind: "list", items };
  };

  const valueNode = (value: string, indent: number): YNode => {
    if (!value) {
      let j = pos.i;
      while (j < lines.length && lines[j].blank) j++;
      if (j >= lines.length) {
        pos.i = j;
        return scalar("");
      }
      const next = lines[j];
      if (next.indent > indent || (next.indent === indent && isItem(next.text))) {
        pos.i = j;
        return block(next.indent);
      }
      return scalar("");
    }
    if (value[0] === "|" || value[0] === ">") {
      // 여러 줄 글: 더 깊이 들여쓴 줄을 모두
      const raws: string[] = [];
      let min = Infinity;
      while (pos.i < lines.length && (lines[pos.i].blank || lines[pos.i].indent > indent)) {
        const l = lines[pos.i];
        if (l.raw.trim()) min = Math.min(min, l.indent);
        raws.push(l.raw);
        pos.i++;
      }
      const cut = min === Infinity ? 0 : min;
      const body = raws.map((r) => r.slice(cut));
      return scalar((value[0] === "|" ? body.join("\n") : body.join(" ")).trim());
    }
    return scalarNode(value);
  };

  skipBlank();
  if (pos.i >= lines.length) return { kind: "map", pairs: [] };
  return block(lines[pos.i].indent);
}

/** GitHub 워크플로 파일: workflow_dispatch 가 있으면 그 입력값(없으면 null) */
export function dispatchInputs(text: string): CIInput[] | null {
  const root = parseYAML(text);
  const on = yget(root, "on") ?? yget(root, "true");
  if (!on) return null;
  if (on.kind === "scalar") return on.value === "workflow_dispatch" ? [] : null;
  if (on.kind === "list") return on.items.some((x) => ystr(x) === "workflow_dispatch") ? [] : null;
  const wd = yget(on, "workflow_dispatch");
  if (!wd) return null;
  return ypairs(yget(wd, "inputs")).map(([name, spec]) => ({
    name,
    description: ystr(yget(spec, "description")) ?? "",
    required: ystr(yget(spec, "required")) === "true",
    defaultValue: ystr(yget(spec, "default")) ?? "",
    type: ystr(yget(spec, "type")) ?? "string",
    options: yitems(yget(spec, "options"))
      .map(ystr)
      .filter((x): x is string => x !== undefined),
  }));
}

/** .gitlab-ci.yml: 설명이 있는 전역 변수(GitLab 의 "파이프라인 실행" 화면에 미리 채워지는 것) */
export function pipelineVariables(text: string): CIInput[] {
  return ypairs(yget(parseYAML(text), "variables")).flatMap(([name, spec]): CIInput[] => {
    const desc = ystr(yget(spec, "description"));
    if (spec.kind !== "map" || desc === undefined) return [];
    const options = yitems(yget(spec, "options"))
      .map(ystr)
      .filter((x): x is string => x !== undefined);
    return [{ name, description: desc, required: false, defaultValue: ystr(yget(spec, "value")) ?? "", type: options.length ? "choice" : "string", options }];
  });
}

// MARK: - API
