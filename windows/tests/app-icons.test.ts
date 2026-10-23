import { describe, expect, it } from "vitest";
import { appIconOptions } from "@/shared/platform/app-icon";

// 앱 아이콘을 하나 더할 때 빠뜨리기 쉬운 것: 원본(assets/app-icons) · Windows 파일(scripts/app-icons.mjs) · 두 플랫폼의 목록
const idsOf = (paths: string[], ext: string) => paths.map((p) => p.split("/").pop()!.slice(0, -ext.length)).sort();
const masters = idsOf(Object.keys(import.meta.glob("../../assets/app-icons/*.png")), ".png");
const icos = idsOf(Object.keys(import.meta.glob("../src-tauri/icons/app/*.ico")), ".ico");
const thumbs = idsOf(Object.keys(import.meta.glob("../src/shared/assets/app-icons/*.png")), ".png");
const raw = (files: Record<string, string>) => Object.values(files)[0] ?? "";
const swift = raw(import.meta.glob<string>("../../macos/Sources/App/AppIcon.swift", { query: "?raw", import: "default", eager: true }));
const conf = raw(import.meta.glob<string>("../src-tauri/tauri.conf.json", { query: "?raw", import: "default", eager: true }));
const extra = appIconOptions.filter((o) => o.id !== "default").map((o) => o.id);

describe("앱 아이콘", () => {
  it("기본이 맨 앞이고 id 는 영문 소문자·숫자", () => {
    expect(appIconOptions[0].id).toBe("default");
    expect(extra.filter((id) => !/^[a-z][a-z0-9]*$/.test(id))).toEqual([]);
  });

  it("원본마다 Windows 목록에 있고, 목록의 아이콘마다 원본이 있다", () => {
    expect(masters.length).toBeGreaterThan(0);
    expect([...extra].sort()).toEqual(masters);
  });

  it("Windows 파일(.ico · 미리 보기)이 있다 — 없으면 node scripts/app-icons.mjs", () => {
    expect(extra.filter((id) => !icos.includes(id) || !thumbs.includes(id))).toEqual([]);
  });

  it("맥 목록(AppIcon.swift)에도 있다", () => {
    expect(swift).toContain("enum AppIcon");
    expect(extra.filter((id) => !new RegExp(`^\\s*case ${id}\\b`, "m").test(swift))).toEqual([]);
  });

  it("설치 파일에 .ico 가 들어간다", () => {
    expect(JSON.parse(conf).bundle.resources).toContain("icons/app/*.ico");
  });
});
