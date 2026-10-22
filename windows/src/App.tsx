import { Menu, Plus, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingView } from "./components/shared/LoadingView";
import { RepoContainer } from "./components/RepoContainer";
import { SettingsDialog, type SettingsTab } from "./components/settings/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { updater } from "./lib/updater";
import { IconButton, MenuHost, showMenuBelow, Spinner, tip, TooltipHost } from "./components/shared/ui";
import { env, isMac, keyLabel } from "./lib/env";
import { ipc } from "./lib/ipc";
import { useObserve } from "./lib/observable";
import type { RepoStore } from "./lib/repo";
import { workspace } from "./lib/workspace";

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
        {workspace.tabs.map((t) => (
          <RepoContainer key={t.id} store={t} visible={t === active} gitMissing={gitMissing} openSettings={() => setSettingsOpen(true)} />
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

function TabBar({ openSettings }: { openSettings: () => void }) {
  useObserve(workspace);
  return (
    <div className="tabbar">
      {workspace.tabs.map((t) => (
        <Tab key={t.id} store={t} on={t === workspace.active} />
      ))}
      <div className="tabbar-end">
        <IconButton icon={<Plus size={16} />} tip={tip("새 탭", "다른 저장소를 새 탭에서 엽니다.", "Ctrl+T")} onClick={() => workspace.newTab()} />
        <span className="spacer" />
      </div>
      <span className="spacer" />
      <div className="tabbar-end">
        <IconButton icon={<Settings size={15} />} tip={tip("설정", "GitHub·GitLab 계정과 Claude 연결", "Ctrl+,")} onClick={openSettings} />
        <IconButton
          icon={<Menu size={16} />}
          tip="메뉴"
          onClick={(e) => {
            const s = workspace.active;
            showMenuBelow(e.currentTarget, [
              { label: "새 탭", shortcut: "Ctrl+T", onClick: () => workspace.newTab() },
              { label: "저장소 열기…", shortcut: "Ctrl+O", onClick: () => void (s?.path ? workspace.newTab() : s)?.pickAndOpen() },
              { label: "저장소 복제…", shortcut: "Ctrl+Shift+O", onClick: () => s && openSheet(s, { kind: "clone" }) },
              { label: "새 저장소 만들기…", onClick: () => void s?.pickAndInit() },
              "divider",
              { label: "새로 고침", shortcut: "F5", disabled: !s?.path, onClick: () => void s?.reload() },
              { label: "커밋 검색", shortcut: "Ctrl+F", disabled: !s?.path, onClick: () => s?.requestSearchFocus() },
              { label: "터미널 보기/숨기기", shortcut: "Ctrl+`", disabled: !s?.path, onClick: () => s?.toggleTerminal() },
              "divider",
              { label: "설정…", shortcut: "Ctrl+,", onClick: openSettings },
              { label: updater.state === "available" ? `업데이트 ${updater.info?.version} 설치…` : "업데이트 확인…", onClick: () => void updater.check(true) },
              { label: `Branchwork ${env.version} · GitHub`, onClick: () => void ipc.openUrl("https://github.com/ChoMnSeong/Branchwork") },
            ]);
          }}
        />
      </div>
    </div>
  );
}

function Tab({ store, on }: { store: RepoStore; on: boolean }) {
  useObserve(store);
  return (
    <div
      className={`tab ${on ? "on" : ""}`}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          workspace.closeTab(store.id);
        } else workspace.select(store.id);
      }}
      data-tip={store.path ? store.path : "새 탭"}
    >
      {(store.loading || store.busy) && <Spinner size={11} />}
      <span className="ellipsis grow" style={{ fontWeight: on ? 600 : 400 }}>
        {store.path ? store.name : store.loading ? store.loading.title : "새 탭"}
      </span>
      <IconButton
        small
        className="close"
        icon={<X size={12} />}
        tip={keyLabel("탭 닫기 (Ctrl+W)")}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => workspace.closeTab(store.id)}
      />
    </div>
  );
}

function openSheet(s: RepoStore, sheet: RepoStore["sheet"]) {
  s.sheet = sheet;
  s.changed();
}

/** 앱 단축키(Windows: Ctrl, 맥: ⌘). 터미널에 포커스가 있으면 터미널이 넘겨준 조합만 온다. */
function handleShortcut(e: KeyboardEvent, openSettings: () => void) {
  if (document.querySelector(".modal-backdrop")) return; // 대화상자가 떠 있으면 대화상자가 처리
  const s = workspace.active;
  if (!s) return;
  const k = e.key.toLowerCase();
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const target = e.target as HTMLElement | null;
  const inText = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") && !target.closest(".xterm");
  const run = (f: () => unknown) => {
    e.preventDefault();
    e.stopPropagation();
    void f();
  };

  if (e.ctrlKey && e.code === "Backquote") return run(() => (s.path ? (e.shiftKey ? s.newTerminal() : s.toggleTerminal()) : undefined));
  if (e.ctrlKey && e.key === "Tab") return run(() => workspace.selectRelative(e.shiftKey ? -1 : 1));
  if (e.key === "F5" || (mod && !e.shiftKey && !e.altKey && k === "r")) return run(() => s.reload());
  if (e.key === "F3") return run(() => (e.shiftKey ? s.previousMatch() : s.nextMatch()));
  if (!mod) return;
  if (inText && !e.shiftKey && !e.altKey && ["a", "c", "v", "x", "z", "y"].includes(k)) return;

  if (!e.shiftKey && !e.altKey) {
    switch (k) {
      case "t":
        return run(() => workspace.newTab());
      case "w":
        return run(() => workspace.closeTab(s.id));
      case "o":
        return run(() => (s.path ? workspace.newTab() : s).pickAndOpen());
      case "f":
        return run(() => s.path && s.requestSearchFocus());
      case "g":
        return run(() => s.nextMatch());
      case "1":
        return run(() => s.path && s.select({ kind: "wip" }));
      case ",":
        return run(openSettings);
    }
  }
  if (e.shiftKey && !e.altKey && s.path) {
    switch (k) {
      case "g":
        return run(() => s.previousMatch());
      case "o":
        return run(() => openSheet(s, { kind: "clone" }));
      case "f":
        return run(() => s.fetch());
      case "l":
        return run(() => s.pull());
      case "p":
        return run(() => s.push());
      case "b":
        return run(() => s.requestNewBranch());
      case "s":
        return run(() => openSheet(s, { kind: "stash" }));
    }
  }
  if (e.shiftKey && !e.altKey && !s.path && k === "o") return run(() => openSheet(s, { kind: "clone" }));
  if (e.altKey && !e.shiftKey && s.path) {
    switch (k) {
      case "w":
        return run(() => openSheet(s, { kind: "addWorktree", branch: null, start: null }));
      case "m":
        return run(() => s.generateCommitMessage());
      case "k":
        return run(() => openSheet(s, { kind: "startAgent", path: s.path }));
    }
  }
}
