import { Menu, Plus, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingView } from "./components/shared/LoadingView";
import { RepoContainer } from "./components/RepoContainer";
import { SettingsDialog, type SettingsTab } from "./components/settings/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { updater } from "./lib/updater";
import { IconButton, MenuHost, showContextMenu, showMenuBelow, Spinner, tip, TooltipHost, type MenuItem } from "./components/shared/ui";
import { env, isMac, keyLabel } from "./lib/env";
import { ipc } from "./lib/ipc";
import { useObserve } from "./lib/observable";
import type { RepoStore } from "./lib/repo";
import { workspace } from "./lib/workspace";
import { t } from "./lib/i18n";

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
          <RepoContainer key={tab.id} store={tab} visible={tab === active} gitMissing={gitMissing} openSettings={() => setSettingsOpen(true)} />
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
      {workspace.tabs.map((tab) => (
        <Tab key={tab.id} store={tab} on={tab === workspace.active} />
      ))}
      <div className="tabbar-end">
        <IconButton icon={<Plus size={16} />} tip={tip(t("New tab"), t("Opens another repository in a new tab."), "Ctrl+T")} onClick={() => workspace.newTab()} />
        <span className="spacer" />
      </div>
      <span className="spacer" />
      <div className="tabbar-end">
        <IconButton icon={<Settings size={15} />} tip={tip(t("Settings"), t("Connect GitHub and GitLab accounts and Claude"), "Ctrl+,")} onClick={openSettings} />
        <IconButton
          icon={<Menu size={16} />}
          tip={t("Menu")}
          onClick={(e) => {
            const s = workspace.active;
            showMenuBelow(e.currentTarget, [
              { label: t("New tab"), shortcut: "Ctrl+T", onClick: () => workspace.newTab() },
              { label: t("Open repository…"), shortcut: "Ctrl+O", onClick: () => void (s?.path ? workspace.newTab() : s)?.pickAndOpen() },
              { label: t("Clone repository…"), shortcut: "Ctrl+Shift+O", onClick: () => s && openSheet(s, { kind: "clone" }) },
              { label: t("Create new repository…"), onClick: () => void s?.pickAndInit() },
              "divider",
              { label: t("Refresh"), shortcut: "F5", disabled: !s?.path, onClick: () => void s?.reload() },
              { label: t("Search commits"), shortcut: "Ctrl+F", disabled: !s?.path, onClick: () => s?.requestSearchFocus() },
              { label: t("Show/hide terminal"), shortcut: "Ctrl+`", disabled: !s?.path, onClick: () => s?.toggleTerminal() },
              "divider",
              { label: t("Settings…"), shortcut: "Ctrl+,", onClick: openSettings },
              { label: updater.state === "available" ? t("Install update {0}…", updater.info?.version) : t("Check for updates…"), onClick: () => void updater.check(true) },
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
        } else if (e.button === 0) workspace.select(store.id);
      }}
      onContextMenu={(e) => showContextMenu(e, tabMenu(store))}
      data-tip={store.path ? store.path : t("New tab")}
    >
      {(store.loading || store.busy) && <Spinner size={11} />}
      <span className="ellipsis grow" style={{ fontWeight: on ? 600 : 400 }}>
        {store.path ? store.name : store.loading ? store.loading.title : t("New tab")}
      </span>
      <IconButton
        small
        className="close"
        icon={<X size={12} />}
        tip={keyLabel(t("Close tab (Ctrl+W)"))}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => workspace.closeTab(store.id)}
      />
    </div>
  );
}

/** 탭 우클릭 메뉴. 닫히는 탭에서 터미널·에이전트 세션이 돌고 있으면 한 번 묻는다(닫으면 함께 끝난다). */
function tabMenu(store: RepoStore): MenuItem[] {
  const others = workspace.tabs.filter((tab) => tab !== store);
  const closing = (tabs: RepoStore[], action: () => void, what: string) => () => {
    const running = tabs.reduce((n, tab) => n + tab.terminals.filter((x) => x.running).length, 0);
    if (!running) return action();
    workspace.select(store.id);
    store.ask({
      title: t("Close {0}?", what),
      message: t("{0} running terminal and agent sessions will end too.", running),
      actionTitle: t("Close"),
      action,
    });
  };
  return [
    { label: t("Close this tab"), shortcut: store === workspace.active ? "Ctrl+W" : undefined, onClick: closing([store], () => workspace.closeTab(store.id), t("This tab")) },
    { label: t("Close other tabs"), disabled: !others.length, onClick: closing(others, () => workspace.closeOthers(store.id), t("{0} other tabs", others.length)) },
    { label: t("Close all tabs"), onClick: closing(workspace.tabs, () => workspace.closeAll(), t("All {0} tabs", workspace.tabs.length)) },
  ];
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
      case "z":
        // 입력 칸 밖에서만(입력 칸에서는 글자 되돌리기 — 위에서 걸러 짐)
        return run(() => s.path && s.confirmUndo());
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
