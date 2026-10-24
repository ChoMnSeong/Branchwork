import { History } from "lucide-react";
import { useEffect, useState } from "react";
import type { GitchBackup } from "@/entities/gitch";
import type { RepoStore } from "@/entities/repo";
import { t } from "@/shared/i18n";
import { Button, Empty, Modal, Spinner } from "@/shared/ui";

/** gitch 자동 백업(gitch rescue): 되돌리기 · 새 브랜치로 꺼내기 (맥 버전 GitchBackupsSheet) */
export function GitchBackupsSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const [backups, setBackups] = useState<GitchBackup[] | null>(null);
  /** 새 브랜치 이름을 받는 중인 백업 */
  const [branchFor, setBranchFor] = useState<GitchBackup | null>(null);
  const [branchName, setBranchName] = useState("");
  useEffect(() => {
    void store.gitchBackups().then(setBackups);
  }, [store]);
  const restoreHere = (b: GitchBackup) =>
    store.ask({
      title: t("Restore this backup?"),
      message: t("The current branch moves back to {0} ({1}). gitch backs up the current state first.", b.date, b.reason),
      actionTitle: t("Restore"),
      destructive: true,
      action: async () => {
        if (await store.gitchRestore(b, null)) close();
      },
    });
  const createBranch = async () => {
    const name = branchName.trim();
    if (!branchFor || !name) return;
    if (await store.gitchRestore(branchFor, name)) close();
  };
  return (
    <Modal title={t("gitch backups")} width={660} onClose={close} footer={<Button onClick={close}>{t("Close")}</Button>}>
      <span className="hint">{t("gitch saves a backup before pull, up, sync, fix, undo and amend, and keeps the 30 most recent.")}</span>
      {backups == null ? (
        <div className="row" style={{ justifyContent: "center", padding: 30 }}>
          <Spinner />
        </div>
      ) : backups.length === 0 ? (
        <div style={{ minHeight: 160 }}>
          <Empty icon={<History size={28} strokeWidth={1.5} />} title={t("No backups yet")} />
        </div>
      ) : (
        <div className="col" style={{ gap: 2, maxHeight: 340, overflow: "auto" }}>
          {backups.map((b) => (
            <div key={b.ref} className="form-section" style={{ gap: 4, padding: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{b.date}</span>
                <span className="chip-warn" style={{ color: "var(--text-2)", background: "var(--hover, rgba(127,127,127,0.15))" }}>
                  {b.reason}
                </span>
                {b.hasChanges && <span className="muted" style={{ fontSize: 11.5 }}>{t("+ uncommitted changes")}</span>}
                <span className="spacer" />
                <Button
                  size="small"
                  onClick={() => {
                    setBranchName("");
                    setBranchFor(branchFor?.ref === b.ref ? null : b);
                  }}
                >
                  {t("Restore to a new branch…")}
                </Button>
                <Button size="small" disabled={store.busy != null} onClick={() => restoreHere(b)}>
                  {t("Restore here…")}
                </Button>
              </div>
              <span className="mono muted ellipsis" style={{ fontSize: 11.5 }}>
                {b.sha} {b.subject}
              </span>
              {branchFor?.ref === b.ref && (
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input grow"
                    autoFocus
                    value={branchName}
                    placeholder={t("New branch name")}
                    onChange={(e) => setBranchName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void createBranch()}
                    spellCheck={false}
                  />
                  <Button size="small" kind="primary" disabled={!branchName.trim() || store.busy != null} onClick={() => void createBranch()}>
                    {t("Create")}
                  </Button>
                </div>
              )}
              {branchFor?.ref === b.ref && <span className="hint">{t("Creates a branch at {0} without changing the current branch.", b.sha)}</span>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
