import { CopyPlus, Download, FolderOpen, TriangleAlert } from "lucide-react";
import { basename, displayPath } from "../lib/env";
import { ipc } from "../lib/ipc";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { recents, removeRecent, settings } from "../lib/settings";
import { tools } from "../lib/tools";
import { Button, showContextMenu } from "./shared/ui";
import icon from "../assets/icon.png";

/** 저장소를 열기 전 첫 화면: 열기·복제·새로 만들기 + 최근 저장소 */
export function WelcomeView({ store }: { store: RepoStore; gitMissing?: boolean }) {
  useObserve(settings);
  useObserve(tools);
  const gitMissing = !tools.path("git");
  const list = recents();
  return (
    <div className="welcome">
      <div className="welcome-main">
        <img src={icon} width={112} height={112} alt="" />
        <div style={{ fontSize: 28, fontWeight: 700 }}>Branchwork</div>
        <div className="muted">Git 저장소를 그래프로 보고 다루는 앱</div>
        {gitMissing && (
          <div className="card" style={{ maxWidth: 420, borderColor: "var(--orange)" }}>
            <span className="row" style={{ color: "var(--orange)", fontWeight: 600 }}>
              <TriangleAlert size={15} /> git 을 찾지 못했습니다
            </span>
            <span className="muted">Branchwork 는 이 PC 의 git 을 그대로 씁니다. Git for Windows 를 설치하거나, 이미 있다면 git.exe 를 직접 불러오세요.</span>
            <div className="row">
              <Button kind="primary" onClick={() => void ipc.openUrl("https://git-scm.com/download/win")}>
                Git for Windows 받기
              </Button>
              <Button
                onClick={() =>
                  void ipc.pickFile("git.exe 선택").then((p) => {
                    if (p)
                      tools.setCustom("git", p).catch((e) => {
                        store.errorMessage = String(e instanceof Error ? e.message : e);
                        store.changed();
                      });
                  })
                }
              >
                git.exe 불러오기…
              </Button>
            </div>
          </div>
        )}
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          <Button kind="primary" size="large" style={{ width: 240 }} onClick={() => void store.pickAndOpen()}>
            <FolderOpen size={15} /> 저장소 열기…
          </Button>
          <Button
            size="large"
            style={{ width: 240 }}
            onClick={() => {
              store.sheet = { kind: "clone" };
              store.changed();
            }}
          >
            <Download size={15} /> 저장소 복제…
          </Button>
          <Button size="large" style={{ width: 240 }} onClick={() => void store.pickAndInit()}>
            <CopyPlus size={15} /> 새 저장소 만들기…
          </Button>
        </div>
      </div>
      <div className="welcome-recents">
        <div style={{ fontWeight: 600, padding: 16 }}>최근 저장소</div>
        {list.length === 0 ? (
          <div className="muted" style={{ padding: "0 16px" }}>
            아직 연 저장소가 없습니다
          </div>
        ) : (
          <div className="col" style={{ overflow: "auto", gap: 2 }}>
            {list.map((p) => (
              <div
                key={p}
                className="recent-item"
                onClick={() => void store.openOrReport(p)}
                onContextMenu={(e) =>
                  showContextMenu(e, [
                    { label: "탐색기에서 보기", onClick: () => void ipc.reveal(p) },
                    { label: "목록에서 제거", onClick: () => removeRecent(p) },
                  ])
                }
              >
                <div style={{ fontWeight: 500 }}>{basename(p)}</div>
                <div className="muted ellipsis" style={{ fontSize: 11.5, direction: "rtl", textAlign: "left" }}>
                  <bdi>{displayPath(p)}</bdi>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
