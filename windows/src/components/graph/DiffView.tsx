import { ChevronLeft, Columns2, Equal, FileArchive, History, ImageOff, Rows3, ScanText, Space, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { splitRows, type SplitRow } from "../../lib/diff";
import { short, type DiffDocument, type DiffLine } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Button, Empty, IconButton, Spinner, StatusBadge } from "../shared/ui";

const LINE_H = 18;
const HUNK_H = 26;

/**
 * 파일 하나의 변경 내용. 그래프 자리를 대신 차지하고, ← 또는 Esc 로 그래프로 돌아간다.
 * 한 줄로 / 나란히 보기, 공백 무시, 단어 단위 강조, 이미지 비교, 덩어리·줄 단위 스테이지. (맥 버전 DiffView)
 */
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
      : source.kind === "commit"
        ? `${c.oldPath ? c.oldPath + " → " : ""}${c.path} · 커밋 ${short(source.sha)}`
        : `${c.oldPath ? c.oldPath + " → " : ""}${c.path} · ${store.target?.provider === "gitlab" ? "MR" : "PR"} #${source.number}`;
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
        {c.kind !== "untracked" && source.kind !== "review" && (
          <>
            <IconButton icon={<History size={15} />} aria-label="파일 히스토리" tip="파일 히스토리|이 파일을 바꾼 커밋들" onClick={() => store.openFileHistory(c.path)} />
            {c.kind !== "deleted" && (
              <IconButton
                icon={<ScanText size={15} />}
                aria-label="줄별 작성자"
                tip="줄별 작성자(blame)|줄마다 누가 언제 바꿨는지"
                onClick={() => store.openBlame(c.path, source.kind === "commit" ? source.sha : null)}
              />
            )}
          </>
        )}
        <div className="segmented" style={{ flex: "none" }}>
          <button type="button" className={!store.diffSplit ? "on" : ""} data-tip="한 줄로 보기" aria-label="한 줄로 보기" onClick={() => store.setDiffSplit(false)}>
            <Rows3 size={14} />
          </button>
          <button type="button" className={store.diffSplit ? "on" : ""} data-tip="나란히 보기(왼쪽 이전 · 오른쪽 이후)" aria-label="나란히 보기" onClick={() => store.setDiffSplit(true)}>
            <Columns2 size={14} />
          </button>
        </div>
        <IconButton
          className={store.diffIgnoreWhitespace ? "on" : ""}
          icon={<Space size={15} />}
          aria-label="공백 무시"
          tip="공백 무시|들여쓰기·공백만 바뀐 줄은 같은 것으로 봅니다(켜 두면 줄 단위 스테이지는 쓸 수 없습니다)"
          onClick={() => store.setDiffIgnoreWhitespace(!store.diffIgnoreWhitespace)}
        />
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
      ) : store.diffImages ? (
        <ImageDiff old={store.diffImages.old} now={store.diffImages.new} />
      ) : doc.isBinary ? (
        <Empty icon={<FileArchive size={30} />} title="바이너리 파일" detail="텍스트가 아닌 파일이라 줄 단위 비교를 표시하지 않습니다." />
      ) : !doc.lines.length ? (
        <Empty
          icon={<Equal size={30} />}
          title="표시할 변경 없음"
          detail={store.diffIgnoreWhitespace ? "공백만 바뀌었습니다(공백 무시를 끄면 보입니다)." : "내용 변경 없이 권한·이름만 바뀌었을 수 있습니다."}
        />
      ) : (
        <DiffBody
          store={store}
          doc={doc}
          split={store.diffSplit}
          editable={store.canEditDiffLines}
          staged={store.diffSource?.kind === "working" && store.diffSource.change.staged}
        />
      )}
    </div>
  );
}

/** 보이는 줄만 그리는 diff 본문(줄마다 높이가 다를 수 있어 위치를 미리 계산). 파일 히스토리에서도 쓴다. */
export function DiffBody({ store, doc, split, editable, staged }: { store: RepoStore; doc: DiffDocument; split: boolean; editable: boolean; staged: boolean }) {
  const rows: SplitRow[] = useMemo(
    () => (split ? splitRows(doc.lines) : doc.lines.map((l, i) => (l.kind === "hunk" || l.kind === "meta" ? { full: i } : { left: i }))),
    [doc, split],
  );
  const heights = useMemo(() => rows.map((r) => (r.full !== undefined && doc.lines[r.full].kind === "hunk" ? HUNK_H : LINE_H)), [rows, doc]);
  const offsets = useMemo(() => {
    const o = [0];
    for (const h of heights) o.push(o[o.length - 1] + h);
    return o;
  }, [heights]);

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
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [doc]);

  const find = (y: number) => {
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const first = Math.max(0, find(vp.top) - 20);
  const last = Math.min(rows.length, find(vp.top + vp.height) + 20);
  const total = offsets[rows.length];

  const lineCell = (i: number | undefined, side: "left" | "right" | "both") => {
    if (i === undefined) return <div className="diff-line empty-cell" style={{ height: LINE_H }} />;
    const l = doc.lines[i];
    const selectable = editable && (l.kind === "added" || l.kind === "removed");
    return (
      <div
        className={`diff-line ${l.kind} ${store.diffSelection.has(i) ? "selected" : ""} ${selectable ? "selectable" : ""} ${side !== "both" ? "clip" : ""}`}
        style={{ height: LINE_H }}
        data-tip={selectable ? "눌러서 이 줄 고르기(Shift: 범위) — 고른 줄만 스테이지할 수 있습니다" : undefined}
        onClick={selectable ? (e) => store.toggleDiffLine(i, e.shiftKey) : undefined}
      >
        {side !== "right" && <span className="no">{l.oldNo ?? ""}</span>}
        {side !== "left" && <span className="no">{l.newNo ?? ""}</span>}
        <span className="mk">{l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}</span>
        <LineText line={l} />
      </div>
    );
  };

  return (
    <div className="diff-scroll" ref={ref} style={split ? { overflowX: "hidden" } : undefined}>
      <div style={{ height: total + (doc.truncated ? 40 : 0), position: "relative", minWidth: split ? undefined : "max-content" }}>
        {rows.slice(first, last).map((r, k) => {
          const n = first + k;
          let content: ReactNode;
          if (r.full !== undefined) {
            const l = doc.lines[r.full];
            content =
              l.kind === "hunk" && l.hunk !== undefined ? (
                <HunkHeader store={store} line={l} hunk={l.hunk} editable={editable} staged={staged} />
              ) : (
                <div className={`diff-line ${l.kind}`} style={{ height: LINE_H }}>
                  <span className="no" />
                  <span className="no" />
                  <span className="mk" />
                  <span>{l.text}</span>
                </div>
              );
          } else if (split) {
            content = (
              <div className="diff-split-row">
                {lineCell(r.left, "left")}
                {lineCell(r.right, "right")}
              </div>
            );
          } else content = lineCell(r.left, "both");
          return (
            <div key={n} style={{ position: "absolute", top: offsets[n], left: 0, right: 0 }}>
              {content}
            </div>
          );
        })}
        {doc.truncated && (
          <div className="muted" style={{ position: "absolute", top: total + 10, left: 12 }}>
            … 변경이 너무 길어 앞부분만 표시합니다
          </div>
        )}
      </div>
    </div>
  );
}

/** 단어 단위로 바뀐 부분을 진하게 */
function LineText({ line }: { line: DiffLine }) {
  const text = line.text || " ";
  if (!line.changes?.length) return <span>{text}</span>;
  const chars = [...text];
  const parts: ReactNode[] = [];
  let pos = 0;
  line.changes.forEach(([a, b], k) => {
    if (a > pos) parts.push(chars.slice(pos, a).join(""));
    parts.push(
      <mark key={k} className="diff-word">
        {chars.slice(a, b).join("")}
      </mark>,
    );
    pos = b;
  });
  if (pos < chars.length) parts.push(chars.slice(pos).join(""));
  return <span>{parts}</span>;
}

/** @@ 줄: 덩어리 위치 + (작업 트리 diff 면) 덩어리·고른 줄 스테이지·언스테이지·버리기 */
function HunkHeader({ store, line, hunk, editable, staged }: { store: RepoStore; line: DiffLine; hunk: number; editable: boolean; staged: boolean }) {
  const picked = editable ? store.selectedCount(hunk) : 0;
  return (
    <div className="diff-line hunk diff-hunk" style={{ height: HUNK_H }}>
      <span className="ellipsis grow" style={{ paddingLeft: 10 }}>
        {line.text}
      </span>
      {editable &&
        (staged ? (
          <Button size="small" onClick={() => void store.applyLines("unstage", hunk)} tip={picked ? "고른 줄만 스테이지에서 뺍니다" : "이 덩어리를 스테이지에서 뺍니다"}>
            {picked ? `고른 줄 언스테이지 (${picked})` : "덩어리 언스테이지"}
          </Button>
        ) : (
          <>
            <Button size="small" onClick={() => store.confirmDiscardLines(hunk)} tip={picked ? "고른 줄의 변경을 작업 트리에서 버립니다" : "이 덩어리의 변경을 작업 트리에서 버립니다"}>
              {picked ? "고른 줄 버리기…" : "덩어리 버리기…"}
            </Button>
            <Button
              size="small"
              kind="primary"
              onClick={() => void store.applyLines("stage", hunk)}
              tip={picked ? "고른 줄만 스테이지합니다" : "이 덩어리만 스테이지합니다(바뀐 줄을 눌러 고르면 그 줄만)"}
            >
              {picked ? `고른 줄 스테이지 (${picked})` : "덩어리 스테이지"}
            </Button>
          </>
        ))}
    </div>
  );
}

/** 이미지 파일: 바뀌기 전과 후를 나란히(크기·용량 함께) */
function ImageDiff({ old, now }: { old: string | null; now: string | null }) {
  return (
    <div className="image-diff">
      <ImagePane title="이전" src={old} tone="red" missing="새로 추가된 파일입니다." />
      <ImagePane title="이후" src={now} tone="green" missing="지운 파일입니다." />
    </div>
  );
}

function ImagePane({ title, src, tone, missing }: { title: string; src: string | null; tone: "red" | "green"; missing: string }) {
  const [size, setSize] = useState("");
  const bytes = src ? Math.round(((src.length - src.indexOf(",") - 1) * 3) / 4) : 0;
  const kb = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return (
    <div className="image-pane">
      <div className="row">
        <span style={{ fontWeight: 600, color: `var(--${tone})` }}>{title}</span>
        <span className="spacer" />
        {src && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {size && `${size} · `}
            {kb}
          </span>
        )}
      </div>
      {src ? (
        <div className={`image-frame ${tone}`}>
          <img src={src} alt={title} onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />
        </div>
      ) : (
        <Empty icon={<ImageOff size={28} />} title="없음" detail={missing} />
      )}
    </div>
  );
}
