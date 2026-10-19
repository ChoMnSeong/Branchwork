import { ChevronDown, ChevronUp, CircleDashed, Search, X } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { drag } from "../lib/drag";
import { laneColor, shortDate } from "../lib/format";
import { isMerge, isWIP, searchScopes, short, type GraphEntry, type GraphRow, type RefLabel, type SearchScope } from "../lib/models";
import { useObserve } from "../lib/observable";
import { branchPayload, commitPayload, type RepoStore } from "../lib/repo";
import { commitMenu, refMenu } from "./menus";
import { Button, Empty, RefBadge, showContextMenu, Spinner, tip } from "./ui";

export const LANE_W = 16;
export const ROW_H = 28;
const LEFT_PAD = 6;
const MAX_LANES = 18;

export const graphWidth = (lanes: number) => Math.max(44, Math.min(lanes, MAX_LANES) * LANE_W + LEFT_PAD * 2);


export function GraphView({ store }: { store: RepoStore }) {
  useObserve(store);
  const gw = graphWidth(store.maxLanes);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  // 선택한 커밋으로 스크롤(가운데)
  useEffect(() => {
    const target = store.scrollTarget;
    const el = scrollRef.current;
    if (!target || !el) return;
    const i = store.commitIndex.get(target);
    store.scrollTarget = null;
    if (i === undefined) return;
    const y = i * ROW_H;
    if (y < el.scrollTop + ROW_H || y > el.scrollTop + el.clientHeight - ROW_H * 2) {
      el.scrollTo({ top: Math.max(0, y - el.clientHeight / 2 + ROW_H / 2), behavior: "smooth" });
    }
  });

  const entries = store.entries;
  const first = Math.max(0, Math.floor(viewport.top / ROW_H) - 10);
  const last = Math.min(entries.length, Math.ceil((viewport.top + viewport.height) / ROW_H) + 10);
  const searching = store.isSearching && (!store.searching || store.searchMatchSet.size > 0);
  const selected = store.selectedID;

  return (
    <div className="col grow" style={{ background: "var(--surface)" }}>
      <SearchBar store={store} />
      <div className="graph-header">
        <span style={{ width: gw, paddingLeft: 6, flex: "none" }}>그래프</span>
        <span className="grow">커밋 메시지</span>
        <span style={{ width: 120, flex: "none" }}>작성자</span>
        <span style={{ width: 90, flex: "none" }}>날짜</span>
        <span style={{ width: 64, flex: "none" }}>SHA</span>
      </div>
      <div
        ref={scrollRef}
        className="graph-scroll"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            store.moveSelection(-1);
            e.preventDefault();
          } else if (e.key === "ArrowDown") {
            store.moveSelection(1);
            e.preventDefault();
          }
        }}
      >
        {entries.length === 0 ? (
          <Empty icon={<CircleDashed size={34} strokeWidth={1.4} />} title="아직 커밋이 없습니다" detail="파일을 만들고 오른쪽에서 첫 커밋을 해 보세요." />
        ) : (
          <div style={{ height: entries.length * ROW_H + (store.hasMore ? 56 : 0), position: "relative" }}>
            {entries.slice(first, last).map((e, k) => {
              const i = first + k;
              return (
                <CommitRow
                  key={e.commit.id}
                  store={store}
                  entry={e}
                  top={i * ROW_H}
                  gw={gw}
                  refs={store.refsByCommit.get(e.commit.id)}
                  selected={selected === e.commit.id}
                  isHead={e.commit.id === store.headHash}
                  wipCount={store.wipCount}
                  match={!searching ? 0 : store.searchMatchSet.has(e.commit.id) ? 1 : 2}
                />
              );
            })}
            {store.hasMore && (
              <div style={{ position: "absolute", top: entries.length * ROW_H + 12, left: 0, right: 0, textAlign: "center" }}>
                <Button onClick={() => void store.loadMore()}>커밋 더 불러오기</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchBar({ store }: { store: RepoStore }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (store.searchFocusRequest) {
      input.current?.focus();
      input.current?.select();
    }
  }, [store.searchFocusRequest]);
  const scope = searchScopes.find((s) => s.id === store.searchScope)!;
  let result = "";
  if (store.isSearching) {
    if (!store.searchMatches.length) result = store.searching ? "찾는 중…" : "결과 없음";
    else {
      result = `${store.searchPosition ?? "–"}/${store.searchMatches.length}`;
      if (store.searchUnloaded > 0) result += ` · 그래프 밖 ${store.searchUnloaded}`;
    }
  }
  return (
    <div className="searchbar">
      <div className="search-field">
        <Search size={14} className="muted" />
        <input
          ref={input}
          value={store.searchText}
          placeholder={scope.prompt}
          spellCheck={false}
          onChange={(e) => store.setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (e.shiftKey) store.previousMatch();
              else store.nextMatch();
            } else if (e.key === "Escape") {
              store.clearSearch();
              input.current?.blur();
            }
          }}
        />
        {store.searching && <Spinner size={12} />}
        {store.searchText && (
          <button className="icon-btn small" data-tip="검색 지우기 (Esc)" onClick={() => store.clearSearch()}>
            <X size={13} />
          </button>
        )}
      </div>
      <select
        className="select"
        style={{ width: 110, height: 28, padding: "0 6px" }}
        value={store.searchScope}
        data-tip="검색 대상"
        onChange={(e) => store.setSearch(store.searchText, e.target.value as SearchScope)}
      >
        {searchScopes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      {store.isSearching && (
        <>
          <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {result}
          </span>
          <div className="tool-group">
            <button className="tool" disabled={!store.searchMatches.length} data-tip="이전 결과 (Shift+Enter · Shift+F3)" onClick={() => store.previousMatch()}>
              <ChevronUp size={15} />
            </button>
            <button className="tool" disabled={!store.searchMatches.length} data-tip="다음 결과 (Enter · F3)" onClick={() => store.nextMatch()}>
              <ChevronDown size={15} />
            </button>
          </div>
          {store.searchUnloaded > 0 && store.hasMore && (
            <Button size="small" onClick={() => void store.loadMoreForSearch()}>
              더 불러와서 찾기
            </Button>
          )}
        </>
      )}
    </div>
  );
}

const CommitRow = memo(function CommitRow({
  store,
  entry,
  top,
  gw,
  refs,
  selected,
  isHead,
  wipCount,
  match,
}: {
  store: RepoStore;
  entry: GraphEntry;
  top: number;
  gw: number;
  refs: RefLabel[] | undefined;
  selected: boolean;
  isHead: boolean;
  wipCount: number;
  match: 0 | 1 | 2;
}) {
  const [dropOn, setDropOn] = useState(false);
  const c = entry.commit;
  const wip = isWIP(c);
  const tint = laneColor(entry.row.color);
  const list = refs ?? [];
  return (
    <div
      className={`commit-row ${selected ? "selected" : ""} ${match === 1 ? "hit" : match === 2 ? "miss" : ""} ${dropOn ? "drop" : ""}`}
      style={{ top }}
      onMouseDown={() => store.select(wip ? { kind: "wip" } : { kind: "commit", sha: c.id })}
      onContextMenu={(e) => showContextMenu(e, commitMenu(store, c))}
      draggable={!wip}
      onDragStart={(e) => {
        drag.payload = commitPayload + c.id;
        e.dataTransfer.setData("text/plain", drag.payload);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (drag.payload = null)}
      onDragOver={(e) => {
        if (!wip && drag.payload) {
          e.preventDefault();
          if (!dropOn) setDropOn(true);
        }
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOn(false);
        const payload = e.dataTransfer.getData("text/plain") || drag.payload;
        drag.payload = null;
        if (payload) store.handleDrop(payload, entry);
      }}
    >
      <GraphCell row={entry.row} width={gw} isWIP={wip} isHead={isHead} isMerge={isMerge(c)} />
      <div className="msg">
        {list.slice(0, 3).map((r) => (
          <Badge key={r.kind + r.name} store={store} label={r} tint={tint} />
        ))}
        {list.length > 3 && (
          <span className="faint" style={{ fontSize: 11 }} data-tip={list.slice(3).map((r) => r.name).join(", ")}>
            +{list.length - 3}
          </span>
        )}
        {wip ? (
          <>
            <i className="muted">// 작업 중인 변경</i>
            <span className="wip-chip" style={{ background: `color-mix(in srgb, ${tint} 18%, transparent)` }}>
              {wipCount}개 파일
            </span>
          </>
        ) : (
          <span className="ellipsis" style={{ color: isMerge(c) ? "var(--text-2)" : undefined }}>
            {c.subject}
          </span>
        )}
      </div>
      <span className="c-author ellipsis muted">{c.author}</span>
      <span className="c-date ellipsis muted">{wip ? "" : shortDate(c.date)}</span>
      <span className="c-sha muted">{wip ? "" : short(c.id)}</span>
    </div>
  );
});

/** 브랜치 배지: 더블클릭 체크아웃, 우클릭 메뉴, 끌어서 다른 브랜치에 놓기 */
function Badge({ store, label, tint }: { store: RepoStore; label: RefLabel; tint: string }) {
  const branch = label.kind === "local" || label.kind === "remote";
  return (
    <span
      draggable={branch}
      onDragStart={(e) => {
        e.stopPropagation();
        drag.payload = branchPayload + label.name;
        e.dataTransfer.setData("text/plain", drag.payload);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (drag.payload = null)}
      onDoubleClick={() => {
        const b = branch ? store.branchNamed(label.name) : null;
        if (b) void store.checkout(b);
      }}
      onContextMenu={(e) => showContextMenu(e, refMenu(store, label))}
      data-tip={branch ? tip(label.name, "더블클릭: 체크아웃 · 다른 브랜치 줄로 끌어 놓기: 머지·리베이스 · 우클릭: 메뉴") : label.name}
      style={{ display: "inline-flex", minWidth: 0 }}
    >
      <RefBadge label={label} color={tint} />
    </span>
  );
}

/** 한 행의 그래프 조각: 위·아래로 이어지는 레인 선과 커밋 노드 */
const GraphCell = memo(function GraphCell({ row, width, isWIP, isHead, isMerge }: { row: GraphRow; width: number; isWIP: boolean; isHead: boolean; isMerge: boolean }) {
  const h = ROW_H;
  const x = (lane: number) => LEFT_PAD + LANE_W * (lane + 0.5);
  const color = laneColor(row.color);
  const cx = x(row.column),
    cy = h / 2;
  const r = isMerge ? 4 : 5.5;
  return (
    <svg width={width} height={h} style={{ flex: "none", overflow: "hidden" }}>
      {row.segments.map((s, i) => {
        const ax = x(s.x1),
          ay = h * s.y1,
          bx = x(s.x2),
          by = h * s.y2;
        const mid = (ay + by) / 2;
        const d = s.x1 === s.x2 ? `M${ax},${ay}L${bx},${by}` : `M${ax},${ay}C${ax},${mid} ${bx},${mid} ${bx},${by}`;
        return <path key={i} d={d} fill="none" stroke={laneColor(s.color)} strokeWidth={2} strokeLinecap="round" strokeDasharray={s.dashed ? "3 3" : undefined} />;
      })}
      {isWIP ? (
        <circle cx={cx} cy={cy} r={r} fill="var(--surface)" stroke={color} strokeWidth={2} strokeDasharray="2.5 2" />
      ) : (
        <>
          <circle cx={cx} cy={cy} r={r + 1.5} fill="var(--surface)" />
          <circle cx={cx} cy={cy} r={r} fill={color} />
        </>
      )}
      {isHead && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={color} strokeWidth={1.5} />}
    </svg>
  );
});
