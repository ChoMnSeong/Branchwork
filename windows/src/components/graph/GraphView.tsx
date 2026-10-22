import { ChevronDown, ChevronUp, CircleDashed, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { searchScopes, type SearchScope } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Button, Empty, Spinner } from "../shared/ui";
import { CommitRow } from "./CommitRow";
import { REF_W, ROW_H, graphWidth } from "./metrics";

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
