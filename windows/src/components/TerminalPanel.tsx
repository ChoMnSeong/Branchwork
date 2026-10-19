import { ChevronDown, ExternalLink, Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { displayPath } from "../lib/env";
import { ipc } from "../lib/ipc";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { settings } from "../lib/settings";
import type { TerminalSession } from "../lib/terminal";
import { Button, IconButton, tip } from "./ui";

/** 가운데 열 아래의 터미널 패널. 경계선을 끌어 높이를 바꾼다. */
export function TerminalPanel({ store, columnHeight }: { store: RepoStore; columnHeight: number }) {
  useObserve(store);
  useObserve(settings);
  const max = Math.max(120, columnHeight - 200);
  const height = Math.min(Math.max(settings.get("terminalHeight", 260), 120), max);
  const s = store.activeTerminal;

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY,
      h0 = height;
    const move = (ev: MouseEvent) => settings.set("terminalHeight", Math.min(Math.max(h0 - (ev.clientY - y0), 120), max));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <>
      <div className="hsplitter" onMouseDown={startDrag} />
      <div className="term-panel" style={{ height }}>
        <div className="term-head">
          <SquareTerminal size={14} className="muted" />
          <div className="term-tabs">
            {store.terminals.map((t, i) => (
              <TermTab key={t.id} t={t} n={store.terminals.length > 1 ? i + 1 : null} on={t === s} store={store} />
            ))}
          </div>
          <IconButton small icon={<Plus size={14} />} tip={tip("새 터미널", "저장소 폴더에서 셸을 하나 더 엽니다.", "Ctrl+Shift+`")} onClick={() => store.newTerminal()} />
          <span className="spacer" />
          {s && (
            <IconButton
              small
              icon={<ExternalLink size={13} />}
              tip={tip("외부 터미널에서 열기", `지금 폴더(${displayPath(s.directory)})를 Windows 터미널 새 창으로 엽니다.`)}
              onClick={() => void ipc.openTerminal(s.directory)}
            />
          )}
          <IconButton
            small
            icon={<ChevronDown size={15} />}
            tip={tip("터미널 숨기기", "패널만 숨기고 셸은 계속 실행됩니다.", "Ctrl+`")}
            onClick={() => {
              store.showTerminal = false;
              store.changed();
            }}
          />
        </div>
        <div className="term-body">{s && <TerminalMount key={s.id} session={s} height={height} store={store} />}</div>
      </div>
    </>
  );
}

function TermTab({ t, n, on, store }: { t: TerminalSession; n: number | null; on: boolean; store: RepoStore }) {
  useObserve(t);
  const color = t.running ? (t.unseenOutput ? "var(--accent)" : "var(--green)") : "var(--text-3)";
  return (
    <div className={`term-tab ${on ? "on" : ""}`} onClick={() => store.selectTerminal(t)} data-tip={displayPath(t.directory)}>
      <span className="dot" style={{ width: 6, height: 6, background: color }} />
      {n !== null && <span className="muted">{n}</span>}
      <span className="ellipsis" style={{ maxWidth: 150 }}>
        {t.title}
      </span>
      <IconButton
        small
        className="x"
        icon={<X size={11} />}
        tip="터미널 닫기"
        onClick={(e) => {
          e.stopPropagation();
          if (t.running && t.spec.program)
            store.ask({ title: "터미널을 닫을까요?", message: `'${t.title}'이(가) 아직 실행 중입니다. 닫으면 함께 종료됩니다.`, actionTitle: "닫기", action: () => store.closeTerminal(t) });
          else store.closeTerminal(t);
        }}
      />
    </div>
  );
}

/** 세션의 xterm 화면을 붙인다. 화면은 세션이 들고 있어 탭을 바꿔도 내용과 셸이 그대로다. */
function TerminalMount({ session, height, store }: { session: TerminalSession; height: number; store: RepoStore }) {
  useObserve(session);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    session.attach(el);
    const ro = new ResizeObserver(() => session.refit());
    ro.observe(el);
    const t = setTimeout(() => session.focus(), 30);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      session.detach();
    };
  }, [session]);
  useEffect(() => {
    session.refit();
  }, [height, session]);
  return (
    <>
      <div className="term-mount" ref={ref} />
      {!session.running && session.started && (
        <div className="term-ended">
          <div className="box">
            <span className="muted">{session.exitCode !== null ? `프로세스가 종료되었습니다 (코드 ${session.exitCode})` : "프로세스가 종료되었습니다"}</span>
            <div className="row">
              <Button kind="primary" onClick={() => void session.start().then(() => session.focus())}>
                다시 시작
              </Button>
              <Button onClick={() => store.closeTerminal(session)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
