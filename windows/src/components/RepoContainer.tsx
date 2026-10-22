import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { settings } from "../lib/settings";
import { DiffView } from "./graph/DiffView";
import { GraphView } from "./graph/GraphView";
import { FileInspectView } from "./graph/FileInspectView";
import { Inspector } from "./inspector/Inspector";
import { LoadingView } from "./shared/LoadingView";
import { SheetHost } from "./sheets";
import { Sidebar } from "./sidebar/Sidebar";
import { TerminalPanel } from "./TerminalPanel";
import { Toolbar } from "./Toolbar";
import { Button, Modal } from "./shared/ui";
import { WelcomeView } from "./WelcomeView";

/** 탭 하나: 저장소 화면 또는 시작 화면, 그 위의 로딩 화면과 대화상자들 */
export function RepoContainer({ store, visible, gitMissing, openSettings }: { store: RepoStore; visible: boolean; gitMissing: boolean; openSettings: () => void }) {
  useObserve(store);
  const showLoading = !store.booted || !!store.loading;
  return (
    <div style={{ position: "absolute", inset: 0, display: visible ? "block" : "none" }}>
      {store.path ? <RepoView store={store} openSettings={openSettings} /> : store.booted && !store.loading ? <WelcomeView store={store} gitMissing={gitMissing} /> : null}
      <FadingLoading show={showLoading} title={store.loading?.title ?? "Branchwork"} step={store.loading?.step ?? "준비 중…"} />
      {visible && <Dialogs store={store} />}
    </div>
  );
}

/** 로딩 화면은 내용이 준비되면 부드럽게 사라진다 */
function FadingLoading({ show, title, step }: { show: boolean; title: string; step: string }) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 420);
      return () => clearTimeout(t);
    }
  }, [show]);
  if (!mounted) return null;
  return <LoadingView title={title} step={step} hidden={!show} />;
}

function Dialogs({ store }: { store: RepoStore }) {
  const close = (f: () => void) => () => {
    f();
    store.changed();
  };
  return (
    <>
      <SheetHost store={store} />
      {store.errorMessage && (
        <Modal
          title="작업을 완료하지 못했습니다"
          width={520}
          onClose={close(() => (store.errorMessage = null))}
          footer={
            <Button kind="primary" autoFocus onClick={close(() => (store.errorMessage = null))}>
              확인
            </Button>
          }
        >
          <div className="modal-message selectable">{store.errorMessage}</div>
        </Modal>
      )}
      {store.notRepoPrompt && (
        <Modal
          title="Git 저장소가 아닙니다"
          onClose={close(() => (store.notRepoPrompt = null))}
          footer={
            <>
              <Button onClick={close(() => (store.notRepoPrompt = null))}>취소</Button>
              <Button
                kind="primary"
                onClick={() => {
                  const p = store.notRepoPrompt!;
                  store.notRepoPrompt = null;
                  store.changed();
                  void store.initRepository(p);
                }}
              >
                여기에 저장소 만들기
              </Button>
            </>
          }
        >
          <div className="modal-message">{store.notRepoPrompt} 에 새 Git 저장소를 만들까요?</div>
        </Modal>
      )}
      {store.unsafePrompt && (
        <Modal
          title="git 이 이 저장소를 막았습니다"
          width={560}
          onClose={close(() => (store.unsafePrompt = null))}
          footer={
            <>
              <Button onClick={close(() => (store.unsafePrompt = null))}>취소</Button>
              <Button kind="primary" onClick={() => void store.trustRepository()}>
                믿을 수 있는 저장소로 등록하고 열기
              </Button>
            </>
          }
        >
          <div className="modal-message">
            저장소 폴더의 소유자가 지금 사용자와 달라서(WSL 안의 저장소, 외장 디스크 등) git 이 안전을 위해 열지 않았습니다. 내가 아는 저장소라면 등록하세요.
          </div>
          <div className="mono selectable" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
            git config --global --add safe.directory '{store.unsafePrompt.safePath}'
          </div>
        </Modal>
      )}
      {store.confirm && (
        <Modal
          title={store.confirm.title}
          onClose={close(() => (store.confirm = null))}
          footer={
            <>
              <Button onClick={close(() => (store.confirm = null))}>취소</Button>
              <Button
                kind={store.confirm.destructive === false ? "primary" : "danger"}
                autoFocus
                onClick={() => {
                  const c = store.confirm!;
                  store.confirm = null;
                  store.changed();
                  void c.action();
                }}
              >
                {store.confirm.actionTitle}
              </Button>
            </>
          }
        >
          <div className="modal-message">{store.confirm.message}</div>
        </Modal>
      )}
      {store.dropRequest && (
        <Modal
          title={store.dropRequest.title}
          width={480}
          onClose={close(() => (store.dropRequest = null))}
          footer={<Button onClick={close(() => (store.dropRequest = null))}>{store.dropRequest.choices.length ? "취소" : "확인"}</Button>}
        >
          <div className="modal-message">{store.dropRequest.message}</div>
          {store.dropRequest.choices.map((c, i) => (
            <Button
              key={i}
              kind={i === 0 ? "primary" : "default"}
              block
              size="large"
              style={{ justifyContent: "flex-start", whiteSpace: "normal", height: "auto", minHeight: 34, textAlign: "left" }}
              onClick={() => {
                store.dropRequest = null;
                store.changed();
                void c.action();
              }}
            >
              {c.title}
            </Button>
          ))}
        </Modal>
      )}
    </>
  );
}

/** 저장소를 연 뒤의 메인 화면: 사이드바 | 그래프 또는 diff (+ 터미널) | 상세 */
function RepoView({ store, openSettings }: { store: RepoStore; openSettings: () => void }) {
  useObserve(settings);
  const sidebarW = settings.get("sidebarWidth", 250);
  const inspectorW = settings.get("inspectorWidth", 380);
  const centerRef = useRef<HTMLDivElement>(null);
  const [centerH, setCenterH] = useState(800);
  useLayoutEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCenterH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const resize = (key: string, start: number, min: number, max: number, sign: 1 | -1) => (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: MouseEvent) => settings.set(key, Math.min(max, Math.max(min, start + sign * (ev.clientX - x0))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="repo">
      <Toolbar store={store} />
      <div className="main">
        <div className="sidebar" style={{ width: sidebarW }}>
          <Sidebar store={store} openSettings={openSettings} />
        </div>
        <div className="splitter" onMouseDown={resize("sidebarWidth", sidebarW, 200, 420, 1)} />
        <div className="center" ref={centerRef}>
          {store.fileInspect ? <FileInspectView store={store} /> : store.diffSource ? <DiffView store={store} /> : <GraphView store={store} />}
          {store.showTerminal && <TerminalPanel store={store} columnHeight={centerH} />}
        </div>
        <div className="splitter" onMouseDown={resize("inspectorWidth", inspectorW, 320, 600, -1)} />
        <div className="inspector" style={{ width: inspectorW }}>
          <Inspector store={store} />
        </div>
      </div>
    </div>
  );
}
