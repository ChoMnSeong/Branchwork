import { ChevronLeft, Clock, Equal, FileArchive, History, ScanText, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { avatars } from "../../lib/avatars";
import { longDate, shortDate } from "../../lib/format";
import { isUncommittedLine, short, type BlameLine } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Avatar, Button, Empty, Segmented, Spinner, tip } from "../shared/ui";
import { DiffBody } from "./DiffView";

const BLAME_H = 18;

/** 파일 히스토리 · 줄별 작성자(blame). 그래프 자리를 대신 차지하고, Esc 로 돌아간다. (맥 버전 FileInspectView) */
export function FileInspectView({ store }: { store: RepoStore }) {
  useObserve(store);
  useObserve(avatars);
  const f = store.fileInspect!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop") && !(e.target as HTMLElement)?.closest?.(".xterm")) store.closeFileInspect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
  const subtitle = f.mode === "history" ? `${f.path} · 커밋 ${store.fileHistory.length}개` : `${f.path} · ${f.rev ? `커밋 ${short(f.rev)} 기준` : "작업 트리 기준"}`;

  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="diff-head">
        <Button size="small" onClick={() => store.closeFileInspect()} tip="그래프로 돌아가기 (Esc)">
          <ChevronLeft size={14} /> 그래프
        </Button>
        <span className="muted" style={{ display: "inline-flex" }}>
          {f.mode === "history" ? <History size={16} /> : <ScanText size={16} />}
        </span>
        <div className="col grow">
          <span className="ellipsis" style={{ fontWeight: 600 }}>
            {f.path.split("/").pop()}
          </span>
          <span className="ellipsis muted" style={{ fontSize: 11.5 }}>
            {subtitle}
          </span>
        </div>
        {store.fileInspectLoading && <Spinner size={13} />}
        <Segmented
          value={f.mode}
          onChange={(m) => store.setFileInspectMode(m)}
          options={[
            { value: "history", label: "히스토리", tip: "이 파일을 바꾼 커밋들" },
            { value: "blame", label: "줄별 작성자", tip: "줄마다 누가 언제 바꿨는지" },
          ]}
        />
      </div>
      {store.fileInspectError ? (
        <Empty icon={<TriangleAlert size={30} />} title="읽지 못했습니다" detail={store.fileInspectError} />
      ) : f.mode === "history" ? (
        <HistoryPane store={store} />
      ) : (
        <BlamePane store={store} />
      )}
    </div>
  );
}

/** 위: 이 파일을 바꾼 커밋들, 아래: 고른 커밋에서의 변경 */
function HistoryPane({ store }: { store: RepoStore }) {
  const doc = store.fileHistoryDiff;
  const listH = Math.min(8, Math.max(2, store.fileHistory.length)) * 40 + 4;
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="history-list" style={{ height: listH }}>
        {store.fileHistory.map((e) => (
          <div
            key={e.commit.id}
            className={`history-row ${store.fileHistorySelected === e.commit.id ? "on" : ""}`}
            onClick={() => void store.selectHistory(e)}
            onDoubleClick={() => {
              store.closeFileInspect();
              store.reveal(e.commit.id);
            }}
            data-tip={tip(e.commit.subject, `${e.commit.author} · ${longDate(e.commit.date)}\n더블클릭: 그래프에서 이 커밋 보기`)}
          >
            <Avatar name={e.commit.author} email={e.commit.email} size={20} url={avatars.url(e.commit.email, e.commit.author)} />
            <div className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis">{e.commit.subject}</span>
              <span className="side-sub row" style={{ gap: 6 }}>
                <span>{e.commit.author}</span>
                <span>{shortDate(e.commit.date)}</span>
                {e.path !== store.fileInspect?.path && <span style={{ color: "var(--orange)" }}>이전 이름: {e.path}</span>}
              </span>
            </div>
            <span className="mono muted" style={{ fontSize: 11.5 }}>
              {short(e.commit.id)}
            </span>
          </div>
        ))}
      </div>
      {!doc ? (
        store.fileHistory.length ? (
          <div className="empty">
            <Spinner size={20} />
          </div>
        ) : store.fileInspectLoading ? null : (
          <Empty icon={<Clock size={30} />} title="히스토리 없음" detail="아직 커밋되지 않은 파일입니다." />
        )
      ) : doc.error ? (
        <Empty icon={<TriangleAlert size={30} />} title="변경을 읽지 못했습니다" detail={doc.error} />
      ) : doc.isBinary ? (
        <Empty icon={<FileArchive size={30} />} title="바이너리 파일" />
      ) : !doc.lines.length ? (
        <Empty icon={<Equal size={30} />} title="내용 변경 없음" detail="이름·권한만 바뀌었을 수 있습니다." />
      ) : (
        <DiffBody store={store} doc={doc} split={store.diffSplit} editable={false} staged={false} />
      )}
    </div>
  );
}

/** 줄마다 마지막으로 바꾼 커밋. 같은 커밋이 이어지면 첫 줄에만 작성자·날짜, 오래된 줄일수록 옅은 띠. */
function BlamePane({ store }: { store: RepoStore }) {
  const lines = store.blameLines;
  const [oldest, newest] = useMemo(() => {
    const ds = lines.filter((l) => !isUncommittedLine(l)).map((l) => l.date);
    return ds.length ? [Math.min(...ds), Math.max(...ds)] : [0, 0];
  }, [lines]);
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);
  if (!lines.length && !store.fileInspectLoading) return <Empty icon={<ScanText size={30} />} title="내용 없음" detail="빈 파일이거나 아직 커밋되지 않았습니다." />;
  const first = Math.max(0, Math.floor(vp.top / BLAME_H) - 20);
  const last = Math.min(lines.length, Math.ceil((vp.top + vp.height) / BLAME_H) + 20);
  const age = (l: BlameLine) => {
    if (isUncommittedLine(l)) return "color-mix(in srgb, var(--orange) 12%, transparent)";
    const t = newest > oldest ? (l.date - oldest) / (newest - oldest) : 1;
    return `color-mix(in srgb, var(--accent) ${Math.round(4 + 16 * t)}%, transparent)`;
  };
  return (
    <div className="diff-scroll" ref={ref}>
      <div style={{ height: lines.length * BLAME_H, position: "relative", minWidth: "max-content" }}>
        <div style={{ position: "absolute", top: first * BLAME_H, left: 0, right: 0 }}>
          {lines.slice(first, last).map((l) => (
            <div key={l.no} className={`diff-line blame-line ${l.startsBlock && l.no > 1 ? "block-start" : ""}`} style={{ height: BLAME_H }}>
              <span
                className="blame-gutter"
                style={{ background: age(l), cursor: l.startsBlock && !isUncommittedLine(l) ? "pointer" : undefined }}
                data-tip={l.startsBlock ? (isUncommittedLine(l) ? "아직 커밋하지 않은 줄" : tip(l.summary, `${l.author} · ${longDate(l.date)}\n눌러서 그래프에서 이 커밋 보기`)) : undefined}
                onClick={() => {
                  if (!l.startsBlock || isUncommittedLine(l)) return;
                  store.closeFileInspect();
                  store.reveal(l.sha);
                }}
              >
                {l.startsBlock &&
                  (isUncommittedLine(l) ? (
                    <span style={{ color: "var(--orange)" }}>커밋하지 않음</span>
                  ) : (
                    <>
                      <Avatar name={l.author} email={l.email} size={14} url={avatars.url(l.email, l.author)} />
                      <span className="ellipsis" style={{ width: 80 }}>
                        {l.author}
                      </span>
                      <span className="muted">{shortDate(l.date)}</span>
                      <span className="spacer" />
                      <span className="muted">{short(l.sha)}</span>
                    </>
                  ))}
              </span>
              <span className="no">{l.no}</span>
              <span style={{ paddingLeft: 8 }}>{l.text || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
