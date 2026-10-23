import { CopyPlus, Download, FolderOpen, TriangleAlert } from "lucide-react";
import { basename, displayPath } from "../lib/env";
import { ipc } from "../lib/ipc";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { recents, removeRecent, settings } from "../lib/settings";
import { tools } from "../lib/tools";
import { Button, showContextMenu } from "./shared/ui";
import icon from "../assets/icon.png";
import { t } from "../lib/i18n";

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
        <div className="muted">{t("An app for viewing and working with Git repositories as a graph")}</div>
        {gitMissing && (
          <div className="card" style={{ maxWidth: 420, borderColor: "var(--orange)" }}>
            <span className="row" style={{ color: "var(--orange)", fontWeight: 600 }}>
              <TriangleAlert size={15} /> {" "}{t("Couldn't find git")}</span>
            <span className="muted">{t("Branchwork uses the git installed on this PC. Install Git for Windows, or locate git.exe if you already have it.")}</span>
            <div className="row">
              <Button kind="primary" onClick={() => void ipc.openUrl("https://git-scm.com/download/win")}>
                {t("Get Git for Windows")}</Button>
              <Button
                onClick={() =>
                  void ipc.pickFile(t("Choose git.exe")).then((p) => {
                    if (p)
                      tools.setCustom("git", p).catch((e) => {
                        store.errorMessage = String(e instanceof Error ? e.message : e);
                        store.changed();
                      });
                  })
                }
              >
                {t("Locate git.exe…")}</Button>
            </div>
          </div>
        )}
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          <Button kind="primary" size="large" style={{ width: 240 }} onClick={() => void store.pickAndOpen()}>
            <FolderOpen size={15} /> {" "}{t("Open repository…")}</Button>
          <Button
            size="large"
            style={{ width: 240 }}
            onClick={() => {
              store.sheet = { kind: "clone" };
              store.changed();
            }}
          >
            <Download size={15} /> {" "}{t("Clone repository…")}</Button>
          <Button size="large" style={{ width: 240 }} onClick={() => void store.pickAndInit()}>
            <CopyPlus size={15} /> {" "}{t("Create new repository…")}</Button>
        </div>
      </div>
      <div className="welcome-recents">
        <div style={{ fontWeight: 600, padding: 16 }}>{t("Recent repositories")}</div>
        {list.length === 0 ? (
          <div className="muted" style={{ padding: "0 16px" }}>
            {t("No repositories opened yet")}</div>
        ) : (
          <div className="col" style={{ overflow: "auto", gap: 2 }}>
            {list.map((p) => (
              <div
                key={p}
                className="recent-item"
                onClick={() => void store.openOrReport(p)}
                onContextMenu={(e) =>
                  showContextMenu(e, [
                    { label: t("Show in Explorer"), onClick: () => void ipc.reveal(p) },
                    { label: t("Remove from list"), onClick: () => removeRecent(p) },
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
