import { describe, expect, it } from "vitest";
import { systemLanguage, t } from "../src/lib/i18n";

describe("화면 언어", () => {
  it("번역이 없으면 원문(영어) 그대로, {0} 은 차례로 넘긴 값", () => {
    expect(t("Commit")).toBe("Commit");
    expect(t("Commit {0} files  {1}", 3, "Ctrl+Enter")).toBe("Commit 3 files  Ctrl+Enter");
    expect(t("Committed {1} of {0} and stopped.", 5, 2)).toBe("Committed 2 of 5 and stopped.");
  });
  it("시스템 언어: 지원하는 첫 언어, 중국어는 간체·번체 구분, 없으면 영어", () => {
    expect(systemLanguage(["ko-KR", "en-US"])).toBe("ko");
    expect(systemLanguage(["zh-TW"])).toBe("zh-Hant");
    expect(systemLanguage(["zh-CN"])).toBe("zh-Hans");
    expect(systemLanguage(["pt-PT"])).toBe("pt-BR");
    expect(systemLanguage(["ar-EG", "sv-SE"])).toBe("en");
  });
});
