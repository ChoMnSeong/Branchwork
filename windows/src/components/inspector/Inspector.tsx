import { ArrowLeft, CircleCheck, CircleMinus, CirclePlus, Clock, ExternalLink, GitBranch, GitMerge, GitPullRequest, Hash, CircleDot, Layers, RefreshCw, Sparkles, TriangleAlert, Waypoints, ArrowDownToLine } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ai } from "../../lib/ai";
import { keyLabel } from "../../lib/env";
import { laneColor, longDate, shortDate } from "../../lib/format";
import { providerInfo, sameDiffSource, short, statusCount, statusIsEmpty, type FileChange } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { ChangeList, FileViewToggle } from "./FileList";
import { Avatar, Button, Card, ChangeBar, Checkbox, Empty, IconButton, LineStatText, RefBadge, Spinner, StatusBadge, tip, type MenuItem } from "../shared/ui";
import { CIStatusIcon } from "../sidebar/CIPanel";
import { statusInfo } from "../../lib/ci/models";

/** 오른쪽 열: 작업 영역 또는 커밋 상세 */
export function Inspector({ store }: { store: RepoStore }) {
  useObserve(store);
  useObserve(ai);
  const sel = store.selection;
  if (!sel) return <Empty icon={<Waypoints size={30} strokeWidth={1.5} />} title="선택된 커밋 없음" detail="그래프에서 커밋을 선택하세요." />;
  if (sel.kind === "wip") return <WorkingChanges store={store} />;
  if (sel.kind === "commit") return <CommitDetailView store={store} sha={sel.sha} />;
  return <PullRequestDetail store={store} number={sel.number} />;
}

// MARK: - 작업 영역

function WorkingChanges({ store }: { store: RepoStore }) {
  const st = store.status;
  const all = [...Object.values(store.stagedStats), ...Object.values(store.unstagedStats)];
  const added = all.reduce((a, s) => a + (s.added ?? 0), 0);
  const deleted = all.reduce((a, s) => a + (s.deleted ?? 0), 0);
  const isOpen = (c: FileChange) => sameDiffSource(store.diffSource, { kind: "working", change: c });
  const open = (c: FileChange) => store.openDiff({ kind: "working", change: c });
  const common = (c: FileChange): MenuItem[] => [
    ...(c.kind !== "untracked" && c.kind !== "added"
      ? ([
          { label: "파일 히스토리", onClick: () => store.openFileHistory(c.path) },
          { label: "줄별 작성자 보기", disabled: c.kind === "deleted", onClick: () => store.openBlame(c.path) },
          "divider",
        ] as MenuItem[])
      : []),
    { label: "탐색기에서 보기", onClick: () => store.revealFile(c) },
    { label: "경로 복사", onClick: () => store.copy(c.path) },
  ];
  return (
    <div className="col grow" style={{ height: "100%" }}>
      <div className="panel-head">
        <div className="col grow">
          <span style={{ fontSize: 15, fontWeight: 600 }}>작업 중인 변경</span>
          <span className="row muted" style={{ fontSize: 11.5 }}>
            <GitBranch size={12} />
            <span className="ellipsis">{store.headBranch ?? "분리된 HEAD"}</span>
            {st.ahead > 0 && <span>↑{st.ahead}</span>}
            {st.behind > 0 && <span>↓{st.behind}</span>}
            {!statusIsEmpty(st) && (
              <>
                <span>·</span>
                <span style={{ whiteSpace: "nowrap" }}>{statusCount(st)}개 파일</span>
                {added + deleted > 0 && <LineStatText added={added} deleted={deleted} />}
              </>
            )}
          </span>
        </div>
        <FileViewToggle />
      </div>
      {store.repoState !== "clean" && (
        <div className="banner">
          <span className="row" style={{ fontWeight: 600, color: "var(--orange)" }}>
            <TriangleAlert size={15} /> {store.repoStateTitle}
          </span>
          <span className="muted">{st.conflicted.length ? "충돌한 파일을 편집기에서 고친 뒤 '해결됨으로 표시' 하세요." : "충돌이 모두 해결됐습니다. 계속 진행하세요."}</span>
          <div className="row">
            <Button onClick={() => store.abortOperation()}>중단…</Button>
            <span className="spacer" />
            <Button kind="primary" disabled={st.conflicted.length > 0} onClick={() => void store.continueOperation()}>
              계속
            </Button>
          </div>
        </div>
      )}
      <div className="panel-scroll">
        <FileSection title="충돌" color="var(--red)" count={st.conflicted.length} actionTitle="모두 해결됨으로 표시" onAction={() => void store.stage(st.conflicted)}>
          <ChangeList
            changes={st.conflicted}
            isSelected={isOpen}
            onOpen={open}
            action={{ icon: <CircleCheck size={14} />, tip: "해결됨으로 표시(스테이지)", run: (f) => void store.stage(f) }}
            menu={(c) => [{ label: "해결됨으로 표시", onClick: () => void store.stage([c]) }, "divider", ...common(c)]}
          />
        </FileSection>
        <FileSection title="스테이지 안 된 파일" color="var(--orange)" count={st.unstaged.length} actionTitle="모두 스테이지" onAction={() => void store.stageAll()}>
          <ChangeList
            changes={st.unstaged}
            isSelected={isOpen}
            onOpen={open}
            stats={store.unstagedStats}
            action={{ icon: <CirclePlus size={14} />, tip: "스테이지", run: (f) => void store.stage(f) }}
            menu={(c) => [
              { label: "스테이지", onClick: () => void store.stage([c]) },
              { label: "변경 버리기…", danger: true, onClick: () => store.confirmDiscard(c) },
              "divider",
              ...common(c),
            ]}
          />
        </FileSection>
        <FileSection title="스테이지된 파일" color="var(--green)" count={st.staged.length} actionTitle="모두 언스테이지" onAction={() => void store.unstageAll()}>
          <ChangeList
            changes={st.staged}
            isSelected={isOpen}
            onOpen={open}
            stats={store.stagedStats}
            action={{ icon: <CircleMinus size={14} />, tip: "언스테이지", run: (f) => void store.unstage(f) }}
            menu={(c) => [{ label: "언스테이지", onClick: () => void store.unstage([c]) }, "divider", ...common(c)]}
          />
        </FileSection>
        {statusIsEmpty(st) && (
          <Card>
            <span className="row" style={{ color: "var(--green)", fontWeight: 600 }}>
              <CircleCheck size={16} /> 작업 디렉터리가 깨끗합니다
            </span>
            <span className="muted">수정한 파일이 생기면 여기에 나타납니다.</span>
          </Card>
        )}
      </div>
      <CommitComposer store={store} />
    </div>
  );
}

function FileSection({ title, color, count, actionTitle, onAction, children }: { title: string; color: string; count: number; actionTitle: string; onAction: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <Card gap={4}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="section-dot" style={{ background: color }} />
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span className="muted">{count}</span>
        <span className="spacer" />
        <button className="link" onClick={onAction}>
          {actionTitle}
        </button>
      </div>
      {children}
    </Card>
  );
}

function CommitComposer({ store }: { store: RepoStore }) {
  const n = store.status.staged.length;
  const title = store.amend ? "이전 커밋 수정" : store.repoState === "merging" ? "머지 커밋" : n === 0 ? "스테이지된 파일 없음" : `${n}개 파일 커밋  ${keyLabel("Ctrl+Enter")}`;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void store.commit();
    }
  };
  return (
    <div className="composer">
      <div className="row" style={{ flexWrap: "wrap" }}>
        {store.me && (
          <span data-tip={`${store.me.name} <${store.me.email}>`}>
            <Avatar name={store.me.name} email={store.me.email} size={22} />
          </span>
        )}
        <span style={{ fontWeight: 600 }}>커밋</span>
        <span className="spacer" />
        <Button
          size="small"
          disabled={store.splittableChanges.length < 2 || !!store.aiWorking || store.status.conflicted.length > 0}
          onClick={() => void store.planSplit()}
          tip={tip(
            "나눠서 커밋",
            `${ai.shortFor("commit")} 가 바뀐 파일을 주요 내용별로 묶어 여러 커밋으로 나눕니다. 나눈 결과를 확인·수정한 뒤 커밋합니다. 규칙은 설정 > 규칙에서.`,
          )}
        >
          <Layers size={13} /> 나눠서 커밋
        </Button>
        <Button
          size="small"
          disabled={!n || !!store.aiWorking}
          onClick={() => void store.generateCommitMessage()}
          tip={tip(`${ai.shortFor("commit")}로 작성`, `스테이지된 변경을 보고 AI 가 커밋 메시지를 씁니다. AI 는 설정 > AI, 규칙은 설정 > 규칙에서 바꿉니다.`, "Ctrl+Alt+M")}
        >
          {store.aiWorking ? (
            <>
              <Spinner size={11} /> 작업 중
            </>
          ) : (
            <>
              <Sparkles size={13} /> {ai.shortFor("commit")}로 작성
            </>
          )}
        </Button>
      </div>
      <div className="composer-box">
        <div className="row" style={{ paddingRight: 8 }}>
          <input value={store.summary} placeholder="요약 (필수)" onChange={(e) => store.setSummary(e.target.value)} onKeyDown={onKey} style={{ fontWeight: 500 }} spellCheck={false} />
          <span style={{ fontSize: 11.5, color: store.summary.length > 72 ? "var(--orange)" : "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{store.summary.length}</span>
        </div>
        <textarea value={store.message} placeholder="자세한 설명 (선택)" onChange={(e) => store.setMessage(e.target.value)} onKeyDown={onKey} spellCheck={false} />
      </div>
      {store.aiWorking && (
        <span className="hint row">
          <Spinner size={11} /> {store.aiWorking}
        </span>
      )}
      {store.aiNotice && <span className="hint">{store.aiNotice}</span>}
      <div className="row">
        <Checkbox checked={store.amend} disabled={!store.headHash} onChange={(v) => void store.setAmend(v)} label="이전 커밋 수정" tip="Amend: 마지막 커밋에 합칩니다" />
        <span className="spacer" />
        <Button kind="primary" size="large" disabled={!store.canCommit} onClick={() => void store.commit()} style={{ minWidth: 140 }}>
          {title}
        </Button>
      </div>
    </div>
  );
}

// MARK: - 커밋 상세

function CommitDetailView({ store, sha }: { store: RepoStore; sha: string }) {
  const [expanded, setExpanded] = useState(false);
  const d = store.detail;
  if (!d || d.sha !== sha)
    return (
      <div className="empty">
        <Spinner size={20} />
      </div>
    );
  const refs = store.refsByCommit.get(sha) ?? [];
  const idx = store.commitIndex.get(sha);
  const tint = idx !== undefined ? laneColor(store.entries[idx].row.color) : "var(--accent)";
  const long = d.body.length > 400 || d.body.split("\n").length > 9;
  const stats = Object.values(store.detailStats);
  const added = stats.reduce((a, s) => a + (s.added ?? 0), 0);
  const deleted = stats.reduce((a, s) => a + (s.deleted ?? 0), 0);
  const explanation = store.explanations[sha];
  return (
    <div className="col grow" style={{ height: "100%" }}>
      <div className="panel-head">
        <span className="muted" style={{ display: "inline-flex" }}>
          {d.parents.length > 1 ? <GitMerge size={15} /> : <CircleDot size={15} />}
        </span>
        <span style={{ fontWeight: 600 }}>{d.parents.length > 1 ? "머지 커밋" : "커밋"}</span>
        <span className="mono muted">{sha.slice(0, 8)}</span>
        <span className="spacer" />
        <span className="muted">{shortDate(d.commitDate)}</span>
      </div>
      <div className="panel-scroll" key={sha}>
        <Card>
          {refs.length > 0 && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              {refs.slice(0, 4).map((r) => (
                <RefBadge key={r.kind + r.name} label={r} color={tint} />
              ))}
              {refs.length > 4 && <span className="faint">+{refs.length - 4}</span>}
            </div>
          )}
          <div className="selectable" style={{ fontSize: 15, fontWeight: 600, wordBreak: "break-word" }}>
            {d.summary}
          </div>
          {d.body && (
            <>
              <div
                className="selectable muted markdown"
                style={long && !expanded ? { maxHeight: 8 * 20, overflow: "hidden", maskImage: "linear-gradient(black 70%, transparent)" } : undefined}
              >
                {d.body}
              </div>
              {long && (
                <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => setExpanded(!expanded)}>
                  {expanded ? "접기" : "전체 보기"}
                </button>
              )}
            </>
          )}
        </Card>
        <Card>
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={d.author} email={d.email} size={34} />
            <div className="col grow">
              <span style={{ fontWeight: 600 }} className="ellipsis">
                {d.author}
              </span>
              <span className="muted ellipsis" style={{ fontSize: 11.5 }}>
                {d.email}
              </span>
            </div>
            <div className="col" style={{ alignItems: "flex-end" }}>
              <span>{shortDate(d.date)}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {longDate(d.date)}
              </span>
            </div>
          </div>
          {(d.committer !== d.author || Math.abs(d.commitDate - d.date) > 60) && (
            <span className="row muted" style={{ fontSize: 11.5 }}>
              <Clock size={12} />
              {d.committer === d.author ? `커밋: ${longDate(d.commitDate)}` : `커밋: ${d.committer} · ${longDate(d.commitDate)}`}
            </span>
          )}
          <div style={{ height: 1, background: "var(--border)" }} />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="pill" data-tip="전체 SHA 복사" onClick={() => store.copy(d.sha)}>
              <Hash size={10} /> {d.sha.slice(0, 8)}
            </button>
            {d.parents.length > 0 && <ArrowLeft size={11} className="faint" />}
            {d.parents.map((p) => (
              <button key={p} className="pill" data-tip="부모 커밋으로 이동" onClick={() => store.reveal(p)}>
                {d.parents.length > 1 && <GitMerge size={10} />} {short(p)}
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <div className="row">
            <span className="row" style={{ color: "var(--accent)", fontWeight: 600 }}>
              <Sparkles size={14} /> {ai.shortFor("explain")} 설명
            </span>
            <span className="spacer" />
            {store.explaining.has(sha) ? (
              <span className="row muted" style={{ fontSize: 12 }}>
                <Spinner size={11} /> 읽는 중
              </span>
            ) : (
              <button className="link" onClick={() => void store.explainCommit(sha)}>
                {explanation ? "다시 설명" : "이 커밋 설명 듣기"}
              </button>
            )}
          </div>
          {explanation && <div className="selectable markdown">{explanation}</div>}
        </Card>
        <Card gap={6}>
          <div className="row">
            <span style={{ fontWeight: 600 }}>변경된 파일</span>
            <span className="muted">{store.detailFiles.length}</span>
            <span className="spacer" />
            <FileViewToggle />
          </div>
          {added + deleted > 0 && (
            <div className="row" style={{ marginBottom: 4 }}>
              <LineStatText added={added} deleted={deleted} />
              <ChangeBar added={added} deleted={deleted} />
            </div>
          )}
          <ChangeList
            changes={store.detailFiles}
            stats={store.detailStats}
            isSelected={(c) => sameDiffSource(store.diffSource, { kind: "commit", sha, change: c, parent: d.parents[0] ?? null })}
            onOpen={(c) => store.openDiff({ kind: "commit", sha, change: c, parent: d.parents[0] ?? null })}
            menu={(c) => [
              { label: "파일 히스토리", onClick: () => store.openFileHistory(c.path) },
              { label: "이 커밋 기준 줄별 작성자 보기", disabled: c.kind === "deleted", onClick: () => store.openBlame(c.path, sha) },
              "divider",
              { label: "경로 복사", onClick: () => store.copy(c.path) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

// MARK: - PR 상세

function PullRequestDetail({ store, number }: { store: RepoStore; number: number }) {
  useObserve(store.ci);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft("");
    void store.loadReview(number);
  }, [store, number]);
  const pr = store.pullRequests.find((p) => p.number === number);
  const t = store.target;
  if (!pr || !t) return <Empty icon={<GitPullRequest size={30} />} title={`목록에 없는 ${t ? providerInfo[t.provider].requestShort : "PR"}`} detail="닫혔거나 아직 불러오지 않았습니다." />;
  const r = store.review?.number === number ? store.review : null;
  const s = r?.state;
  const ci = pr.headSHA ? store.ci.bySha.get(pr.headSHA) : undefined;
  const text = draft.trim();
  const after = (ok: boolean) => ok && setDraft("");
  return (
    <div className="col grow" style={{ height: "100%" }}>
      <div className="panel-head">
        <GitPullRequest size={15} className="muted" />
        <span style={{ fontWeight: 600 }}>
          {providerInfo[t.provider].requestShort} #{pr.number}
        </span>
        {pr.isDraft && <span className="chip-warn">Draft</span>}
        <span className="spacer" />
        {store.reviewLoading && <Spinner size={12} />}
        <IconButton small icon={<RefreshCw size={12} />} tip="대화·승인 새로 고침" onClick={() => void store.loadReview(number)} />
      </div>
      <div className="panel-scroll" key={number}>
        <div className="selectable" style={{ fontSize: 16, fontWeight: 600 }}>
          {pr.title}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px" }}>
          <span className="muted">작성자</span>
          <span>@{pr.author}</span>
          <span className="muted">브랜치</span>
          <span className="selectable">
            {pr.source} → {pr.target}
            {pr.fromFork ? "  (포크)" : ""}
          </span>
          {pr.updated && (
            <>
              <span className="muted">업데이트</span>
              <span>{longDate(pr.updated)}</span>
            </>
          )}
          {ci && (
            <>
              <span className="muted">CI</span>
              <span className="row" style={{ gap: 4 }}>
                <CIStatusIcon status={ci.status} size={12} />
                {statusInfo[ci.status].title} · #{ci.number}
                <button className="link" onClick={() => store.openUrl(ci.url)}>
                  열기
                </button>
              </span>
            </>
          )}
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Button kind="primary" onClick={() => void store.checkoutPullRequest(pr)}>
            <ArrowDownToLine size={14} /> 브랜치 체크아웃
          </Button>
          <Button onClick={() => store.openUrl(pr.url)}>
            <ExternalLink size={14} /> 브라우저
          </Button>
          {pr.headSHA && store.commitIndex.has(pr.headSHA) && <Button onClick={() => store.reveal(pr.headSHA!)}>그래프에서 보기</Button>}
        </div>
        <div style={{ height: 1, background: "var(--border)" }} />
        {pr.body.trim() ? <div className="selectable markdown">{pr.body}</div> : <span className="muted">설명 없음</span>}
        {store.reviewError && (
          <span className="error-text" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
            {store.reviewError}
          </span>
        )}
        {r && s && (
          <>
            <div className="col" style={{ gap: 4 }}>
              <span style={{ fontWeight: 600 }}>리뷰</span>
              {!s.approvedBy.length && !s.changesRequestedBy.length && <span className="muted">아직 승인한 사람이 없습니다.</span>}
              {s.approvedBy.length > 0 && <span style={{ color: "var(--green)" }}>✓ 승인: {s.approvedBy.map((x) => "@" + x).join(", ")}</span>}
              {s.changesRequestedBy.length > 0 && <span style={{ color: "var(--orange)" }}>변경 요청: {s.changesRequestedBy.map((x) => "@" + x).join(", ")}</span>}
              {s.approvalsLeft != null && s.approvalsLeft > 0 && <span className="muted" style={{ fontSize: 11.5 }}>승인 {s.approvalsLeft}명이 더 필요합니다.</span>}
            </div>
            <div className="col" style={{ gap: 2 }}>
              <span style={{ fontWeight: 600 }}>바뀐 파일 {r.files.length}</span>
              {r.files.map((f) => {
                const open = store.diffSource?.kind === "review" && store.diffSource.number === number && store.diffSource.change.path === f.path;
                return (
                  <div
                    key={f.path}
                    className="side-row review-file"
                    style={{ background: open ? "var(--select)" : undefined }}
                    data-tip={f.patch ? "눌러서 가운데에 diff 보기" : "바이너리이거나 너무 커서 브라우저에서 보세요"}
                    onClick={() => store.openReviewFile(number, f)}
                  >
                    <StatusBadge kind={f.kind} />
                    <span className="ellipsis">{f.path.split("/").pop()}</span>
                    <span className="side-sub ellipsis grow">{f.path.split("/").slice(0, -1).join("/")}</span>
                    <LineStatText added={f.additions} deleted={f.deletions} />
                  </div>
                );
              })}
            </div>
            <div className="col" style={{ gap: 8 }}>
              <span style={{ fontWeight: 600 }}>대화 {r.comments.filter((c) => c.kind !== "system").length}</span>
              {r.comments.map((c) =>
                c.kind === "system" ? (
                  <span key={c.id} className="muted" style={{ fontSize: 11.5 }}>
                    @{c.author} {c.body}
                  </span>
                ) : (
                  <div key={c.id} className="review-comment">
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>@{c.author}</span>
                      {c.kind === "approved" && <span style={{ color: "var(--green)", fontSize: 11.5 }}>✓ 승인</span>}
                      {c.kind === "changesRequested" && <span style={{ color: "var(--orange)", fontSize: 11.5 }}>변경 요청</span>}
                      <span className="spacer" />
                      {c.date != null && <span className="muted" style={{ fontSize: 11.5 }}>{shortDate(c.date)}</span>}
                    </div>
                    {c.path && (
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {c.path}
                        {c.line != null ? `:${c.line}` : ""}
                      </span>
                    )}
                    {c.body && <div className="selectable markdown">{c.body}</div>}
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </div>
      <div className="col" style={{ gap: 6, padding: 10, borderTop: "1px solid var(--border)" }}>
        <textarea
          className="textarea"
          style={{ height: 58 }}
          placeholder="댓글 · 리뷰 의견"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text) void store.postReviewComment(number, text).then(after);
          }}
        />
        <div className="row" style={{ gap: 6 }}>
          {store.reviewBusy && <Spinner size={12} />}
          <span className="spacer" />
          {t.provider === "github" && (
            <Button size="small" disabled={!text || store.reviewBusy} tip="의견을 남기며 변경을 요청합니다(의견 필수)" onClick={() => void store.requestChanges(number, text).then(after)}>
              변경 요청
            </Button>
          )}
          {t.provider === "gitlab" && s?.approvedByMe ? (
            <Button size="small" disabled={store.reviewBusy} onClick={() => void store.unapprovePullRequest(number)}>
              승인 취소
            </Button>
          ) : (
            <Button size="small" disabled={store.reviewBusy || !!s?.approvedByMe} tip={text ? "의견과 함께 승인합니다" : "승인합니다"} onClick={() => void store.approvePullRequest(number, text).then(after)}>
              ✓ 승인
            </Button>
          )}
          <Button size="small" kind="primary" disabled={!text || store.reviewBusy} tip={keyLabel("댓글 달기 (Ctrl+Enter)")} onClick={() => void store.postReviewComment(number, text).then(after)}>
            댓글
          </Button>
        </div>
      </div>
    </div>
  );
}
