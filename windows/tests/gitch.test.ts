import { describe, expect, it } from "vitest";
import { fromPosix, linkTarget, parseAccounts, parseBackups, parsePreflight, parseStatus, plain, versionOf } from "@/entities/gitch";

describe("gitch 출력 읽기", () => {
  it("status: 빈 글자는 null 로(잠기지 않은 저장소를 잠긴 것으로 보지 않게)", () => {
    const s = parseStatus('{"inRepo":true,"lockedAccount":"","account":"alice","accountSource":"folder","pushAccount":"alice","ignored":false,"warnings":[]}');
    expect(s).toEqual({ inRepo: true, lockedAccount: null, account: "alice", accountSource: "folder", pushAccount: "alice", ignored: false });
    expect(parseStatus('{"inRepo":false,"folderAccount":null}')?.inRepo).toBe(false);
    expect(parseStatus("not json")).toBeNull();
  });

  it("preflight: STOP 이어도 JSON 을 그대로", () => {
    const p = parsePreflight('{"result":"STOP","checks":[{"level":"STOP","code":"identity","message":"작성자가 다릅니다"}]}');
    expect(p?.result).toBe("STOP");
    expect(p?.checks[0].message).toBe("작성자가 다릅니다");
    expect(parsePreflight("{}")).toBeNull();
  });

  it("list: 계정과 규칙 문구", () => {
    const a = parseAccounts('{"accounts":[{"id":"bob","email":"bob@example.com","hosts":"github.com","rules":"~/Develop/bob, 조직 github.com/teamb","sshKey":false,"current":false}]}');
    expect(a).toEqual([{ id: "bob", email: "bob@example.com", hosts: "github.com", rules: "~/Develop/bob, 조직 github.com/teamb", sshKey: false }]);
    expect(parseAccounts("")).toEqual([]);
  });

  it("백업: 최근 것이 먼저, 수정 중이던 파일(-wip)은 따로 보이지 않고 표시만", () => {
    const out = [
      "refs/gitsw/backup/20261023-163654-pl\tab12cd3\tWIP 제목",
      "refs/gitsw/backup/20261023-163654-pl-wip\tff00ff0\twip",
      "refs/gitsw/backup/20261022-090000-fix\t1234567\t제목\t탭",
    ].join("\n");
    expect(parseBackups(out)).toEqual([
      { ref: "refs/gitsw/backup/20261023-163654-pl", date: "2026-10-23 16:36:54", reason: "pl", sha: "ab12cd3", subject: "WIP 제목", hasChanges: true },
      { ref: "refs/gitsw/backup/20261022-090000-fix", date: "2026-10-22 09:00:00", reason: "fix", sha: "1234567", subject: "제목\t탭", hasChanges: false },
    ]);
  });

  it("버전 · Windows 연결 스크립트 · 경로 · 색 코드", () => {
    expect(versionOf('#!/bin/bash\n# ...\nGITSW_VERSION="3.1.0"\n')).toBe("3.1.0");
    expect(linkTarget('#!/bin/sh\n# gitch-link: /c/Users/me/AppData/Local/Gitrochi/gitch\nexec "/c/Users/me/AppData/Local/Gitrochi/gitch" "$@"\n')).toBe("/c/Users/me/AppData/Local/Gitrochi/gitch");
    expect(linkTarget('#!/bin/bash\nGITSW_VERSION="3.1.0"\n')).toBeNull();
    expect(fromPosix("/c/Users/me/x")).toBe("C:/Users/me/x");
    expect(fromPosix("C:/Users/me/x")).toBe("C:/Users/me/x");
    expect(plain("\u001b[32m✔\u001b[0m 설치 완료 \n")).toBe("✔ 설치 완료");
  });
});
