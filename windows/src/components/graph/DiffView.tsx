import { ChevronLeft, Equal, FileArchive, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { short, type DiffLine } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Button, Empty, Spinner, StatusBadge } from "../shared/ui";

const LINE_H = 18;

/** 파일 하나의 변경 내용. 그래프 자리를 대신 차지하고, ← 또는 Esc 로 그래프로 돌아간다. */
export function DiffView({ store }: { store: RepoStore }) {
  useObserve(store);
  const source = store.diffSource!;
  const c = source.change;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop") && !(e.target as HTMLElement)?.closest?.(".xterm")) store.closeDiff();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const subtitle =
    source.kind === "working"
      ? `${c.path} · ${c.kind === "conflicted" ? "충돌" : c.staged ? "스테이지됨" : "작업 트리"}`
      : `${c.oldPath ? c.oldPath + " → " : ""}${c.path} · 커밋 ${short(source.sha)}`;
  const doc = store.diff;

  return (
    <div className="col grow">
      <div className="diff-head">
        <Button size="small" onClick={() => store.closeDiff()} tip="그래프로 돌아가기 (Esc)">
          <ChevronLeft size={14} /> 그래프
        </Button>
        <StatusBadge kind={c.kind} />
        <div className="col grow">
          <span className="ellipsis" style={{ fontWeight: 600 }}>
            {c.path.split("/").pop()}
          </span>
          <span className="ellipsis muted" style={{ fontSize: 11.5 }}>
            {subtitle}
          </span>
        </div>
        {source.kind === "working" &&
          (c.kind === "conflicted" ? (
            <Button onClick={() => void store.stage([c])}>해결됨으로 표시</Button>
          ) : c.staged ? (
            <Button onClick={() => void store.unstage([c])}>언스테이지</Button>
          ) : (
            <>
              <Button kind="danger" onClick={() => store.confirmDiscard(c)}>
                변경 버리기…
              </Button>
              <Button kind="primary" onClick={() => void store.stage([c])}>
                스테이지
              </Button>
            </>
          ))}
      </div>
      {!doc ? (
        <div className="empty">
          <Spinner size={20} />
        </div>
      ) : doc.error ? (
        <Empty icon={<TriangleAlert size={30} />} title="변경 내용을 불러오지 못했습니다" detail={doc.error} />
      ) : doc.isBinary ? (
        <Empty icon={<FileArchive size={30} />} title="바이너리 파일" detail="텍스트가 아닌 파일이라 줄 단위 비교를 표시하지 않습니다." />
      ) : !doc.lines.length ? (
        <Empty icon={<Equal size={30} />} title="표시할 변경 없음" detail="내용 변경 없이 권한·이름만 바뀌었을 수 있습니다." />
      ) : (
        <DiffLines lines={doc.lines} truncated={doc.truncated} />
      )}
    </div>
  );
}

/** 긴 diff 도 빠르게: 보이는 줄만 그린다 */
function DiffLines({ lines, truncated }: { lines: DiffLine[]; truncated: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [lines]);
  const first = Math.max(0, Math.floor(vp.top / LINE_H) - 20);
  const last = Math.min(lines.length, Math.ceil((vp.top + vp.height) / LINE_H) + 20);
  return (
    <div className="diff-scroll" ref={ref}>
      <div style={{ height: lines.length * LINE_H + (truncated ? 40 : 0), position: "relative", minWidth: "max-content" }}>
        <div style={{ position: "absolute", top: first * LINE_H, left: 0, right: 0 }}>
          {lines.slice(first, last).map((l, i) => (
            <div key={first + i} className={`diff-line ${l.kind}`} style={{ height: LINE_H, padding: 0 }}>
              <span className="no">{l.oldNo ?? ""}</span>
              <span className="no">{l.newNo ?? ""}</span>
              <span className="mk">{l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}</span>
              <span>{l.text || " "}</span>
            </div>
          ))}
        </div>
        {truncated && (
          <div className="muted" style={{ position: "absolute", top: lines.length * LINE_H + 10, left: 12 }}>
            … 변경이 너무 길어 앞부분만 표시합니다
          </div>
        )}
      </div>
    </div>
  );
}
