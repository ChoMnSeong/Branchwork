import { Folder, FolderOpen, Lock, Plus, TriangleAlert } from "lucide-react";
import { displayPath, isTemporaryPath, samePath } from "../../lib/env";
import { ipc } from "../../lib/ipc";
import { short } from "../../lib/models";
import type { RepoStore } from "../../lib/repo";
import { IconButton, showContextMenu } from "../shared/ui";
import { Section } from "./Section";

export function WorktreeSection({ store }: { store: RepoStore }) {
  return (
    <Section
      id="worktrees"
      title="워크트리"
      count={store.worktrees.length}
      actions={
        <>
          {store.worktrees.some((w) => w.prunable) && (
            <button className="link" onClick={() => void store.pruneWorktrees()}>
              정리
            </button>
          )}
          <IconButton
            small
            icon={<Plus size={13} />}
            tip="새 워크트리"
            onClick={() => {
              store.sheet = { kind: "addWorktree", branch: null, start: null };
              store.changed();
            }}
          />
        </>
      }
    >
      {store.worktrees.map((w) => {
        const current = samePath(w.path, store.path);
        return (
          <div
            key={w.path}
            className={`side-row ${current ? "current" : ""}`}
            style={{ alignItems: "flex-start" }}
            onDoubleClick={() => void store.openOrReport(w.path)}
            onContextMenu={(e) =>
              showContextMenu(e, [
                { label: "Branchwork 에서 열기", disabled: current, onClick: () => void store.openOrReport(w.path) },
                { label: "탐색기에서 보기", onClick: () => void ipc.reveal(w.path) },
                { label: "아래 터미널에서 열기", onClick: () => store.newTerminal(w.path) },
                { label: "외부 터미널에서 열기", onClick: () => void ipc.openTerminal(w.path) },
                { label: "에이전트 실행", onClick: () => void store.startAgent(w.path) },
                { label: "경로 복사", onClick: () => store.copy(displayPath(w.path)) },
                "divider",
                { label: "제거…", danger: true, disabled: w.isMain || current, onClick: () => store.confirmRemove(w) },
                { label: "강제 제거…", danger: true, disabled: w.isMain || current, onClick: () => store.confirmRemove(w, true) },
              ])
            }
            data-tip="더블클릭: 새 탭에서 열기"
          >
            <span className="lead" style={{ marginTop: 2 }}>
              {current ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="col grow">
              <span className="ellipsis">{w.branch ?? `분리된 HEAD ${w.head ? short(w.head) : ""}`}</span>
              <span className="side-sub ellipsis" style={{ direction: "rtl", textAlign: "left" }}>
                <bdi>{displayPath(w.path)}</bdi>
              </span>
            </span>
            {isTemporaryPath(w.path) && !w.prunable && (
              <span className="chip-warn" data-tip="임시 폴더 안의 워크트리 — 재부팅하면 폴더가 지워져 깨질 수 있습니다">
                임시
              </span>
            )}
            {w.prunable ? (
              <span style={{ color: "var(--orange)" }} data-tip="폴더가 사라진 워크트리 — '정리'로 지울 수 있습니다">
                <TriangleAlert size={13} />
              </span>
            ) : (
              w.locked && (
                <span className="muted" data-tip="잠긴 워크트리">
                  <Lock size={12} />
                </span>
              )
            )}
          </div>
        );
      })}
    </Section>
  );
}
