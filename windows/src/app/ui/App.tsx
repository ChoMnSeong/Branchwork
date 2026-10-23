import { useEffect, useState } from "react";
import { SettingsDialog, type SettingsTab } from "@/widgets/settings";
import { TabBar } from "@/widgets/tab-bar";
import { UpdateDialog } from "@/widgets/update-dialog";
import { workspace } from "@/entities/workspace";
import { useObserve } from "@/shared/lib";
import { LoadingView, MenuHost, TooltipHost } from "@/shared/ui";
import { handleShortcut } from "../lib/shortcuts";
import { RepoTab } from "./RepoTab";

export function App({ gitMissing }: { gitMissing: boolean }) {
  useObserve(workspace);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("accounts");

  // 다른 화면에서 "설정 > 도구" 등으로 바로 보내기
  useEffect(() => {
    const open = (e: Event) => {
      setSettingsTab(((e as CustomEvent).detail as SettingsTab) ?? "accounts");
      setSettingsOpen(true);
    };
    window.addEventListener("bw-open-settings", open);
    return () => window.removeEventListener("bw-open-settings", open);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleShortcut(e, () => setSettingsOpen(true));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = workspace.active;
  return (
    <div className="col" style={{ height: "100%" }}>
      <TabBar openSettings={() => setSettingsOpen(true)} />
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--surface)" }}>
        {workspace.tabs.map((tab) => (
          <RepoTab key={tab.id} store={tab} visible={tab === active} gitMissing={gitMissing} openSettings={() => setSettingsOpen(true)} />
        ))}
        {!workspace.tabs.length && <LoadingView title="Branchwork" step={workspace.restoreStep} />}
      </div>
      {settingsOpen && (
        <SettingsDialog
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab("accounts");
          }}
        />
      )}
      <UpdateDialog />
      <MenuHost />
      <TooltipHost />
    </div>
  );
}
