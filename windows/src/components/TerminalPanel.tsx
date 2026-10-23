import { ChevronDown, ExternalLink, Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { displayPath } from "../lib/env";
import { ipc } from "../lib/ipc";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { settings } from "../lib/settings";
import type { TerminalSession } from "../lib/terminal";
import { Button, IconButton, tip } from "./shared/ui";
import { t } from "../lib/i18n";

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
            {store.terminals.map((term, i) => (
              <TermTab key={term.id} term={term} n={store.terminals.length > 1 ? i + 1 : null} on={term === s} store={store} />
            ))}
          </div>
          <IconButton small icon={<Plus size={14} />} tip={tip(t("New terminal"), t("Opens another shell in the repository folder."), "Ctrl+Shift+`")} onClick={() => store.newTerminal()} />
          <span className="spacer" />
          {s && (
            <IconButton
              small
              icon={<ExternalLink size={13} />}
              tip={tip(t("Open in external terminal"), t("Opens the current folder ({0}) in a new Windows Terminal window.", displayPath(s.directory)))}
              onClick={() => void ipc.openTerminal(s.directory)}
            />
          )}
          <IconButton
            small
            icon={<ChevronDown size={15} />}
            tip={tip(t("Hide terminal"), t("Only the panel is hidden; shells keep running."), "Ctrl+`")}
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

function TermTab({ term, n, on, store }: { term: TerminalSession; n: number | null; on: boolean; store: RepoStore }) {
  useObserve(term);
  const color = term.running ? (term.unseenOutput ? "var(--accent)" : "var(--green)") : "var(--text-3)";
  return (
    <div className={`term-tab ${on ? "on" : ""}`} onClick={() => store.selectTerminal(term)} data-tip={displayPath(term.directory)}>
      <span className="dot" style={{ width: 6, height: 6, background: color }} />
      {n !== null && <span className="muted">{n}</span>}
      <span className="ellipsis" style={{ maxWidth: 150 }}>
        {term.title}
      </span>
      <IconButton
        small
        className="x"
        icon={<X size={11} />}
        tip={t("Close terminal")}
        onClick={(e) => {
          e.stopPropagation();
          if (term.running && term.spec.program)
            store.ask({ title: t("Close the terminal?"), message: t("'{0}' is still running. Closing it will stop it.", term.title), actionTitle: t("Close"), action: () => store.closeTerminal(term) });
          else store.closeTerminal(term);
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
    const timer = setTimeout(() => session.focus(), 30);
    return () => {
      clearTimeout(timer);
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
            <span className="muted">{session.exitCode !== null ? t("The process exited (code {0})", session.exitCode) : t("The process exited")}</span>
            <div className="row">
              <Button kind="primary" onClick={() => void session.start().then(() => session.focus())}>
                {t("Restart")}</Button>
              <Button onClick={() => store.closeTerminal(session)}>{t("Close")}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
