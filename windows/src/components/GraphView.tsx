import { Check, ChevronDown, ChevronUp, CircleDashed, Cloud, Crosshair, Laptop, Search, Tag as TagIcon, X } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { drag } from "../lib/drag";
import { laneColor, shortDate } from "../lib/format";
import { isMerge, isWIP, searchScopes, short, type GraphEntry, type GraphRow, type RefLabel, type SearchScope } from "../lib/models";
import { useObserve } from "../lib/observable";
import { avatars } from "../lib/avatars";
import { branchPayload, commitPayload, type RepoStore } from "../lib/repo";
import { commitMenu, refMenu } from "./menus";
import { Avatar, Button, Empty, showContextMenu, Spinner, tip } from "./ui";

export const LANE_W = 22;
export const ROW_H = 30;
const LEFT_PAD = 6;
const MAX_LANES = 16;
/** 왼쪽 브랜치·태그 칸 너비 */
export const REF_W = 190;
/** 커밋 동그라미(프로필) 지름 */
const AVATAR = 20;

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
        <span style={{ width: REF_W, paddingLeft: 10, flex: "none" }}>브랜치 / 태그</span>
        <span style={{ width: gw, paddingLeft: 6, flex: "none" }}>그래프</span>
        <span className="grow" style={{ paddingLeft: 8 }}>커밋 메시지</span>
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
  const groups = groupRefs(refs ?? []);
  return (
    <div
      className={`commit-row ${selected ? "selected" : ""} ${match === 1 ? "hit" : match === 2 ? "miss" : ""} ${dropOn ? "drop" : ""}`}
      style={{ top, gap: 0 }}
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
      {/* 왼쪽: 브랜치·태그(첫 번째 + 나머지 개수)와 그래프까지 이어지는 선 */}
      <div className="ref-col" style={{ width: REF_W, background: groups.length ? `color-mix(in srgb, ${tint} 10%, transparent)` : undefined }}>
        {groups.length > 0 && (
          <>
            <RefPill store={store} group={groups[0]} tint={tint} />
            {groups.length > 1 && (
              <span
                className="ref-more"
                style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}
                data-tip={groups.slice(1).map((g) => g.name).join("\n")}
                onContextMenu={(e) =>
                  showContextMenu(
                    e,
                    groups.slice(1).map((g) => ({ label: g.name, submenu: g.all.length > 1 ? g.all.map((r) => ({ label: r.name, submenu: refMenu(store, r) })) : refMenu(store, g.primary) })),
                  )
                }
              >
                +{groups.length - 1}
              </span>
            )}
            <span className="ref-line" style={{ background: tint }} />
          </>
        )}
      </div>
      <div style={{ background: `color-mix(in srgb, ${tint} ${groups.length ? 10 : 4}%, transparent)`, display: "flex" }}>
        <GraphCell row={entry.row} width={gw} isWIP={wip} isHead={isHead} isMerge={isMerge(c)} hasRefs={groups.length > 0} author={c.author} email={c.email} />
      </div>
      <div className="msg" style={{ paddingLeft: 8 }}>
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
      <span className="c-author ellipsis muted" style={{ paddingLeft: 8 }}>
        {c.author}
      </span>
      <span className="c-date ellipsis muted">{wip ? "" : shortDate(c.date)}</span>
      <span className="c-sha muted">{wip ? "" : short(c.id)}</span>
    </div>
  );
});

/** 같은 이름의 로컬·원격 브랜치를 한 라벨로 묶은 것(💻 로컬, ☁ 원격) */
interface RefGroup {
  name: string;
  isCurrent: boolean;
  local: string | null;
  remotes: string[];
  isTag: boolean;
  isHead: boolean;
  primary: RefLabel;
  all: RefLabel[];
}

export function groupRefs(refs: RefLabel[]): RefGroup[] {
  const order: string[] = [];
  const by = new Map<string, { local: string | null; remotes: string[]; current: boolean }>();
  const heads: RefGroup[] = [];
  const tags: RefGroup[] = [];
  for (const r of refs) {
    if (r.kind === "head") {
      const l: RefLabel = { name: "HEAD", kind: "head", isCurrent: true };
      heads.push({ name: "HEAD", isCurrent: true, local: null, remotes: [], isTag: false, isHead: true, primary: l, all: [l] });
    } else if (r.kind === "tag") {
      tags.push({ name: r.name, isCurrent: false, local: null, remotes: [], isTag: true, isHead: false, primary: r, all: [r] });
    } else {
      const key = r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name;
      if (!by.has(key)) {
        order.push(key);
        by.set(key, { local: null, remotes: [], current: false });
      }
      const g = by.get(key)!;
      if (r.kind === "local") {
        g.local = r.name;
        g.current = r.isCurrent;
      } else g.remotes.push(r.name);
    }
  }
  const branches: RefGroup[] = order.map((name) => {
    const g = by.get(name)!;
    const all: RefLabel[] = [...(g.local ? [{ name: g.local, kind: "local" as const, isCurrent: g.current }] : []), ...g.remotes.map((n) => ({ name: n, kind: "remote" as const, isCurrent: false }))];
    return { name, isCurrent: g.current, local: g.local, remotes: g.remotes, isTag: false, isHead: false, primary: all[0], all };
  });
  const rank = (g: RefGroup) => (g.isCurrent ? 0 : g.local ? 1 : 2);
  branches.sort((a, b) => rank(a) - rank(b));
  return [...heads, ...branches, ...tags];
}

/** 브랜치 라벨: 더블클릭 체크아웃, 우클릭 메뉴, 끌어서 다른 브랜치에 놓기 */
function RefPill({ store, group, tint }: { store: RepoStore; group: RefGroup; tint: string }) {
  const branch = !group.isTag && !group.isHead;
  const color = group.isTag ? "#8e8e93" : group.isHead ? "var(--text)" : tint;
  const solid = group.isCurrent;
  const target = group.local ?? group.remotes[0] ?? group.name;
  const tipText = [
    group.local ? `로컬: ${group.local}${group.isCurrent ? " (현재)" : ""}` : "",
    group.remotes.length ? `원격: ${group.remotes.join(", ")}` : "",
    group.isTag ? `태그: ${group.name}` : "",
    branch ? "더블클릭: 체크아웃 · 다른 브랜치 줄로 끌어 놓기: 머지·리베이스 · 우클릭: 메뉴" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={`ref-pill ${solid ? "solid" : ""}`}
      style={{
        color: solid ? "#fff" : color,
        background: solid ? color : `color-mix(in srgb, ${color} 18%, transparent)`,
        boxShadow: solid ? undefined : `inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`,
      }}
      draggable={branch}
      onDragStart={(e) => {
        e.stopPropagation();
        drag.payload = branchPayload + target;
        e.dataTransfer.setData("text/plain", drag.payload);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (drag.payload = null)}
      onDoubleClick={() => {
        const b = branch ? store.branchNamed(target) : null;
        if (b) void store.checkout(b);
      }}
      onContextMenu={(e) =>
        showContextMenu(e, group.all.length > 1 ? group.all.map((r) => ({ label: r.name, submenu: refMenu(store, r) })) : refMenu(store, group.primary))
      }
      data-tip={tip(group.name, tipText)}
    >
      {solid && <Check size={9} strokeWidth={3.5} />}
      {group.isTag && <TagIcon size={10} strokeWidth={2.5} />}
      {group.isHead && <Crosshair size={10} strokeWidth={2.5} />}
      <span className="name">{group.name}</span>
      {group.local && <Laptop size={10} strokeWidth={2.2} />}
      {group.remotes.length > 0 && <Cloud size={10} strokeWidth={2.2} />}
    </span>
  );
}

/** 커밋 동그라미: 작성자 프로필 사진(없으면 이니셜) */
function AvatarNode({ name, email, x }: { name: string; email: string; x: number }) {
  useObserve(avatars);
  const url = avatars.url(email);
  const ok = url && !avatars.failed.has(url);
  return (
    <span className="avatar-node" style={{ left: x - AVATAR / 2, top: (ROW_H - AVATAR) / 2 }} data-tip={name}>
      {ok ? (
        <img src={url} width={AVATAR} height={AVATAR} alt="" draggable={false} onError={() => avatars.markFailed(url)} />
      ) : (
        <Avatar name={name} email={email} size={AVATAR} />
      )}
    </span>
  );
}

/** 한 행의 그래프 조각: 위·아래로 이어지는 레인 선, 브랜치 라벨에서 오는 선, 커밋 동그라미 */
const GraphCell = memo(function GraphCell({
  row,
  width,
  isWIP,
  isHead,
  isMerge,
  hasRefs,
  author,
  email,
}: {
  row: GraphRow;
  width: number;
  isWIP: boolean;
  isHead: boolean;
  isMerge: boolean;
  hasRefs: boolean;
  author: string;
  email: string;
}) {
  const h = ROW_H;
  const x = (lane: number) => LEFT_PAD + LANE_W * (lane + 0.5);
  const color = laneColor(row.color);
  const cx = x(row.column),
    cy = h / 2;
  const avatarNode = !isWIP && !isMerge;
  return (
    <span style={{ position: "relative", width, height: h, flex: "none", display: "block" }}>
      <svg width={width} height={h} style={{ display: "block", overflow: "hidden" }}>
        {hasRefs && <line x1={0} y1={cy} x2={cx} y2={cy} stroke={color} strokeWidth={1.5} />}
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
          <circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke={color} strokeWidth={2} strokeDasharray="2.5 2" />
        ) : isMerge ? (
          <>
            <circle cx={cx} cy={cy} r={5.5} fill="var(--surface)" />
            <circle cx={cx} cy={cy} r={4} fill={color} />
          </>
        ) : (
          <circle cx={cx} cy={cy} r={AVATAR / 2 + 2} fill={color} />
        )}
        {isHead && <circle cx={cx} cy={cy} r={isMerge ? 8 : AVATAR / 2 + 5} fill="none" stroke={color} strokeWidth={1.5} />}
      </svg>
      {avatarNode && <AvatarNode name={author} email={email} x={cx} />}
    </span>
  );
});
