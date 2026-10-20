import { ArrowDown, ArrowUp, Globe, Lock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { accounts } from "../lib/accounts";
import { ai } from "../lib/ai";
import { agentKind, agentKinds, agents, type AgentKind } from "../lib/agents";
import { tools } from "../lib/tools";
import { displayPath, env, isWindows, joinPath, slash } from "../lib/env";
import { validBranchName } from "../lib/format";
import * as Hosting from "../lib/hosting";
import { ipc } from "../lib/ipc";
import { accountApiBase, accountHost, providerInfo, type RemoteRepo, type SheetKind } from "../lib/models";
import { useObserve } from "../lib/observable";
import type { RepoStore, SplitGroup } from "../lib/repo";
import { Button, Checkbox, IconButton, Modal, Segmented, Spinner, StatusBadge } from "./ui";

export function SheetHost({ store }: { store: RepoStore }) {
  const s = store.sheet;
  if (!s) return null;
  const close = () => {
    store.sheet = null;
    store.changed();
  };
  return <SheetSwitch store={store} sheet={s} close={close} />;
}

function SheetSwitch({ store, sheet, close }: { store: RepoStore; sheet: SheetKind; close: () => void }) {
  switch (sheet.kind) {
    case "clone":
      return <CloneSheet store={store} close={close} />;
    case "stash":
      return <StashSheet store={store} close={close} />;
    case "newBranch":
      return <NewBranchSheet store={store} close={close} start={sheet.start} label={sheet.label} />;
    case "tag":
      return <TagSheet store={store} close={close} sha={sheet.sha} />;
    case "createPullRequest":
      return <CreatePullRequestSheet store={store} close={close} />;
    case "startAgent":
      return <StartAgentSheet store={store} close={close} presetPath={sheet.path} />;
    case "addWorktree":
      return <AddWorktreeSheet store={store} close={close} presetBranch={sheet.branch} start={sheet.start} />;
    case "splitCommits":
      return <SplitCommitsSheet store={store} close={close} />;
  }
}

function Frame({
  title,
  confirm,
  canConfirm,
  onConfirm,
  close,
  width = 500,
  children,
  leftFooter,
}: {
  title: string;
  confirm: string;
  canConfirm: boolean;
  onConfirm: () => void;
  close: () => void;
  width?: number;
  children: ReactNode;
  leftFooter?: ReactNode;
}) {
  const submit = () => {
    if (!canConfirm) return;
    close();
    onConfirm();
  };
  return (
    <Modal
      title={title}
      width={width}
      onClose={close}
      footer={
        <>
          {leftFooter && <span className="hint grow">{leftFooter}</span>}
          <Button onClick={close}>취소</Button>
          <Button kind="primary" disabled={!canConfirm} onClick={submit}>
            {confirm}
          </Button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-row">
      <label>{label}</label>
      <div className="row">{children}</div>
    </div>
  );
}

function NewBranchSheet({ store, close, start, label }: { store: RepoStore; close: () => void; start: string; label: string }) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  return (
    <Frame title="새 브랜치" confirm="만들기" canConfirm={validBranchName(name)} close={close} onConfirm={() => void store.createBranch(name.trim(), start, checkout)}>
      <Row label="이름">
        <input className="input" autoFocus value={name} placeholder="feature/새-기능" onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label="시작 위치">
        <span className="mono">{label}</span>
      </Row>
      <Row label="">
        <Checkbox checked={checkout} onChange={setCheckout} label="만든 뒤 체크아웃" />
      </Row>
    </Frame>
  );
}

function TagSheet({ store, close, sha }: { store: RepoStore; close: () => void; sha: string }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Frame title="태그 만들기" confirm="만들기" canConfirm={!!name.trim() && !/\s/.test(name.trim())} close={close} onConfirm={() => void store.createTag(name.trim(), message, sha)}>
      <Row label="이름">
        <input className="input" autoFocus value={name} placeholder="v1.0.0" onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label="메시지">
        <input className="input" value={message} placeholder="비우면 가벼운 태그" onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label="커밋">
        <span className="mono">{sha.slice(0, 10)}</span>
      </Row>
    </Frame>
  );
}

function StashSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  return (
    <Frame title="변경 사항 Stash" confirm="Stash" canConfirm close={close} onConfirm={() => void store.stash(message, untracked)}>
      <Row label="메시지">
        <input className="input" autoFocus value={message} placeholder="선택 사항" onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label="">
        <Checkbox checked={untracked} onChange={setUntracked} label="추적하지 않는 새 파일도 포함" />
      </Row>
    </Frame>
  );
}

/** https://host/a/b.git, git@host:a/b.git → "b" */
function guessName(url: string) {
  const last = url.trim().split(/[/:]/).pop() ?? "";
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

function CloneSheet({ store, close }: { store: RepoStore; close: () => void }) {
  useObserve(accounts);
  const [accountID, setAccountID] = useState<string | null>(accounts.accounts[0]?.id ?? null);
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState("");
  const [parent, setParent] = useState(isWindows() ? joinPath(env.home, "source", "repos") : joinPath(env.home, "Desktop"));
  const [folder, setFolder] = useState("");
  const [folderEdited, setFolderEdited] = useState(false);

  useEffect(() => {
    const a = accounts.accounts.find((x) => x.id === accountID);
    if (!a) return;
    let cancelled = false;
    setLoadingRepos(true);
    setReposError(null);
    void (async () => {
      try {
        const token = await accounts.token(a);
        if (!token) throw new Error("토큰이 없습니다. 설정에서 계정을 다시 연결하세요.");
        const list = await Hosting.repositories(a.provider, token, accountApiBase(a));
        if (!cancelled) setRepos(list);
      } catch (e) {
        if (!cancelled) {
          setRepos([]);
          setReposError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!cancelled) setLoadingRepos(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountID]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  const setURL = (v: string) => {
    setRemote(v);
    if (!folderEdited) setFolder(guessName(v));
  };

  return (
    <Frame
      title="저장소 복제"
      confirm="복제"
      width={600}
      canConfirm={!!remote.trim() && !!folder.trim()}
      close={close}
      onConfirm={() => void (async () => {
        await ipc.mkdirs(parent).catch(() => {});
        await store.clone(remote.trim(), parent, folder.trim());
      })()}
    >
      {accounts.accounts.length > 0 && (
        <div className="form-section">
          <div className="row">
            <span className="form-section-title grow">내 저장소</span>
            <select className="select" style={{ width: 260 }} value={accountID ?? ""} onChange={(e) => setAccountID(e.target.value)}>
              {accounts.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.provider === "github" ? "GitHub" : accountHost(a)} · @{a.username}
                </option>
              ))}
            </select>
          </div>
          <input className="input" placeholder="검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div style={{ height: 180, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--input)" }}>
            {loadingRepos ? (
              <div className="empty">
                <Spinner />
              </div>
            ) : reposError ? (
              <div className="error-text" style={{ padding: 10 }}>
                {reposError}
              </div>
            ) : (
              filtered.map((r) => (
                <div
                  key={r.fullName}
                  className="file-row"
                  style={{ background: r.cloneURL === remote ? "var(--select)" : undefined, alignItems: "flex-start" }}
                  onClick={() => setURL(r.cloneURL)}
                >
                  <span className="muted" style={{ marginTop: 2 }}>
                    {r.isPrivate ? <Lock size={12} /> : <Globe size={12} />}
                  </span>
                  <span className="col grow">
                    <span className="ellipsis">{r.fullName}</span>
                    {r.summary && (
                      <span className="muted ellipsis" style={{ fontSize: 11.5 }}>
                        {r.summary}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <Row label="URL">
        <input className="input" autoFocus value={remote} placeholder="https://github.com/사용자/저장소.git" onChange={(e) => setURL(e.target.value)} spellCheck={false} />
      </Row>
      <Row label="위치">
        <span className="ellipsis grow">{displayPath(parent)}</span>
        <Button
          size="small"
          onClick={() =>
            void ipc.pickFolder("복제할 위치", parent).then((p) => {
              if (p) setParent(slash(p));
            })
          }
        >
          변경…
        </Button>
      </Row>
      <Row label="폴더 이름">
        <input
          className="input"
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value);
            setFolderEdited(true);
          }}
          spellCheck={false}
        />
      </Row>
    </Frame>
  );
}

function CreatePullRequestSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const provider = store.target?.provider ?? "github";
  const [title, setTitle] = useState(() => {
    const b = store.headBranch ?? "";
    return (b.split("/").pop() ?? b).replace(/-/g, " ");
  });
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [bases] = useState(() => store.pullRequestBaseCandidates());
  const [draft, setDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    void store.defaultBaseBranch().then((b) => b && setBase((cur) => cur || b));
  }, [store]);
  return (
    <Frame
      title={`새 ${providerInfo[provider].requestName}`}
      confirm="만들기"
      width={640}
      canConfirm={!!title.trim() && !!base}
      close={close}
      onConfirm={() => void store.createPullRequest(title.trim(), body, base, draft)}
      leftFooter={store.status.upstream == null || store.status.ahead > 0 ? `만들기 전에 현재 브랜치를 ${store.target?.remote ?? "원격"}에 Push 합니다.` : undefined}
    >
      <div className="row">
        <span className="mono">{store.headBranch}</span>
        <span className="muted">→</span>
        <select className="select" style={{ width: 240 }} value={base} onChange={(e) => setBase(e.target.value)}>
          {!base && <option value="">대상 브랜치</option>}
          {bases.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <input className="input" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="textarea" style={{ height: 220 }} value={body} placeholder="설명 (Markdown)" onChange={(e) => setBody(e.target.value)} />
      <div className="row">
        <Checkbox checked={draft} onChange={setDraft} label="Draft" />
        <span className="spacer" />
        {generating && <Spinner />}
        <Button
          disabled={generating || !base}
          onClick={() => {
            setGenerating(true);
            void store.draftPullRequest(base).then((d) => {
              if (d) {
                setTitle(d[0]);
                setBody(d[1]);
              }
              setGenerating(false);
            });
          }}
        >
          <Sparkles size={13} /> {ai.shortFor("pullRequest")}로 작성
        </Button>
      </div>
    </Frame>
  );
}

function AddWorktreeSheet({ store, close, presetBranch, start }: { store: RepoStore; close: () => void; presetBranch: string | null; start: string | null }) {
  const used = new Set(store.worktrees.map((w) => w.branch).filter(Boolean));
  const free = store.localBranches.map((b) => b.name).filter((n) => !used.has(n));
  const [createNew, setCreateNew] = useState(!presetBranch);
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(presetBranch ?? free[0] ?? "");
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [runClaude, setRunClaude] = useState(false);
  const [task, setTask] = useState("");
  const [exists, setExists] = useState(false);
  const branch = createNew ? name.trim() : existing;

  useEffect(() => {
    if (!pathEdited && branch) setPath(store.defaultWorktreePath(branch));
  }, [branch, pathEdited, store]);
  useEffect(() => {
    if (!path.trim()) return;
    void ipc.exists(path).then(setExists);
  }, [path]);

  const valid = validBranchName(branch) && !!path.trim() && !exists;
  return (
    <Frame
      title="새 워크트리"
      confirm="만들기"
      width={580}
      canConfirm={valid}
      close={close}
      onConfirm={() => void store.addWorktree(path, branch, createNew, createNew ? start : null, runClaude, task)}
      leftFooter="한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다."
    >
      <Segmented
        stretch
        value={createNew ? "new" : "existing"}
        onChange={(v) => setCreateNew(v === "new")}
        options={[
          { value: "new", label: "새 브랜치 만들기" },
          { value: "existing", label: "기존 브랜치" },
        ]}
      />
      {createNew ? (
        <>
          <Row label="새 브랜치 이름">
            <input className="input" autoFocus value={name} placeholder="feature/새-작업" onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </Row>
          <Row label="시작 위치">
            <span className="mono">{start ? start.slice(0, 10) : store.headBranch ?? "HEAD"}</span>
          </Row>
        </>
      ) : (
        <Row label="체크아웃할 브랜치">
          <select className="select" value={existing} onChange={(e) => setExisting(e.target.value)}>
            {free.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="위치">
        <input
          className="input"
          value={displayPath(path)}
          onChange={(e) => {
            setPath(slash(e.target.value));
            setPathEdited(true);
          }}
          spellCheck={false}
        />
        <Button
          size="small"
          onClick={() =>
            void ipc.pickFolder("이 안에 워크트리를 만듭니다").then((p) => {
              if (p) {
                setPath(joinPath(slash(p), branch ? branch.replace(/\//g, "-") : "worktree"));
                setPathEdited(true);
              }
            })
          }
        >
          변경…
        </Button>
      </Row>
      {exists && <span className="error-text">이 위치에 이미 폴더가 있습니다.</span>}
      <Row label="">
        <Checkbox checked={runClaude} onChange={setRunClaude} label={`만든 뒤 ${agentKind(agents.defaultKind).title.split(" (")[0]} 실행`} />
      </Row>
      {runClaude && (
        <textarea className="textarea" style={{ height: 64 }} value={task} placeholder="에이전트에게 맡길 작업 (선택) — 예: 로그인 화면에 비밀번호 찾기 추가" onChange={(e) => setTask(e.target.value)} />
      )}
    </Frame>
  );
}

function StartAgentSheet({ store, close, presetPath }: { store: RepoStore; close: () => void; presetPath: string | null }) {
  useObserve(tools);
  /** 빈 문자열 = 새 워크트리 만들기 */
  const [target, setTarget] = useState(presetPath ?? store.path ?? store.worktrees[0]?.path ?? "");
  const [kind, setKind] = useState<AgentKind>(agents.defaultKind);
  const [newBranch, setNewBranch] = useState("");
  const [task, setTask] = useState("");
  const [mode, setMode] = useState("");
  const [exists, setExists] = useState(false);
  const info = agentKind(kind);
  const found = !!tools.path(info.tool);
  const wtPath = newBranch.trim() ? store.defaultWorktreePath(newBranch.trim()) : "";
  useEffect(() => {
    if (wtPath) void ipc.exists(wtPath).then(setExists);
  }, [wtPath]);
  useEffect(() => setMode(""), [kind]);
  const validBranch = validBranchName(newBranch) && !exists;
  return (
    <Frame
      title="에이전트 세션 시작"
      confirm="시작"
      width={580}
      canConfirm={found && (!!target || validBranch)}
      close={close}
      leftFooter="아래 터미널의 새 탭에서 실행되고, 상태는 에이전트 탭에 표시됩니다."
      onConfirm={() =>
        void (async () => {
          const m = mode || null;
          if (!target) {
            if (await store.addWorktree(wtPath, newBranch.trim(), true, null, false, "")) await store.startAgent(wtPath, task, m, kind);
          } else await store.startAgent(target, task, m, kind);
        })()
      }
    >
      <Row label="에이전트">
        <Segmented
          value={kind}
          onChange={setKind}
          options={agentKinds.map((k) => ({
            value: k.id,
            label: (
              <span style={{ opacity: tools.path(k.tool) ? 1 : 0.45 }}>
                {k.title.split(" (")[0]}
              </span>
            ),
            tip: tools.path(k.tool) ? k.title : `${k.title} — 찾지 못함(설정 > 도구에서 불러오기)`,
          }))}
        />
      </Row>
      {!found && <span className="error-text">{info.title} 실행 파일을 찾지 못했습니다. 설정 &gt; 도구에서 불러오거나 설치하세요.</span>}
      <Row label="작업할 곳">
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {store.worktrees.map((w) => (
            <option key={w.path} value={w.path}>
              {(w.branch ?? "분리된 HEAD") + (w.path === store.path ? "  (지금 연 곳)" : "")}
            </option>
          ))}
          <option value="">새 워크트리 만들기…</option>
        </select>
      </Row>
      {!target && (
        <>
          <Row label="새 브랜치 이름">
            <input className="input" autoFocus value={newBranch} placeholder="feature/ai-작업" onChange={(e) => setNewBranch(e.target.value)} spellCheck={false} />
          </Row>
          <Row label="위치">
            <span className="ellipsis muted">{wtPath ? displayPath(wtPath) : "-"}</span>
          </Row>
        </>
      )}
      <Row label="맡길 작업">
        <textarea className="textarea" style={{ height: 80 }} value={task} placeholder="예: 로그인 실패 시 잠금 처리 추가하고 테스트까지" onChange={(e) => setTask(e.target.value)} />
      </Row>
      <Row label="권한 모드">
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          {info.modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
    </Frame>
  );
}

/** 나눠서 커밋: AI 가 나눈 계획을 보고 메시지·파일을 고친 뒤 차례로 커밋 */
function SplitCommitsSheet({ store, close }: { store: RepoStore; close: () => void }) {
  useObserve(store);
  const [groups, setGroups] = useState<SplitGroup[]>(() => store.splitPlan ?? []);
  const changes = new Map(store.splittableChanges.map((c) => [c.path, c]));
  const valid = groups.filter((g) => g.files.length);
  const ready = valid.length > 0 && valid.every((g) => g.message.trim());
  const leftover = store.splittableChanges.map((c) => c.path).filter((p) => !groups.some((g) => g.files.includes(p)));

  const update = (id: string, f: (g: SplitGroup) => SplitGroup) => setGroups((gs) => gs.map((g) => (g.id === id ? f(g) : g)));
  const move = (path: string, to: string) =>
    setGroups((gs) => {
      let next = gs.map((g) => ({ ...g, files: g.files.filter((p) => p !== path) }));
      if (to === "new") next = [...next, { id: crypto.randomUUID(), message: "", files: [path] }];
      else if (to !== "skip") next = next.map((g) => (g.id === to ? { ...g, files: [...g.files, path] } : g));
      return next;
    });
  const shift = (i: number, d: number) =>
    setGroups((gs) => {
      const j = i + d;
      if (j < 0 || j >= gs.length) return gs;
      const n = [...gs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const fileRow = (p: string, current: string | null) => {
    const c = changes.get(p);
    return (
      <div key={p} className="file-row" style={{ paddingLeft: 2 }}>
        {c && <StatusBadge kind={c.kind} />}
        <span className="ellipsis grow" data-tip={p}>
          {p}
        </span>
        <select className="select" style={{ width: 150, height: 24, padding: "0 4px", fontSize: 12 }} value={current ?? "skip"} onChange={(e) => move(p, e.target.value)}>
          {groups.map((g, i) => (
            <option key={g.id} value={g.id}>
              {i + 1}번 커밋으로
            </option>
          ))}
          <option value="new">새 커밋으로</option>
          <option value="skip">커밋하지 않음</option>
        </select>
      </div>
    );
  };

  return (
    <Modal
      title="나눠서 커밋"
      width={720}
      onClose={close}
      footer={
        <>
          <span className="hint grow">
            스테이지 상태를 비우고 위에서부터 차례로 스테이지 → 커밋합니다. {leftover.length > 0 && `커밋하지 않는 ${leftover.length}개 파일은 그대로 남습니다.`}
          </span>
          <Button
            disabled={!!store.aiWorking}
            onClick={() => {
              close();
              void store.planSplit();
            }}
          >
            다시 나누기
          </Button>
          <Button onClick={close}>취소</Button>
          <Button
            kind="primary"
            disabled={!ready || store.busy != null}
            onClick={() => {
              const plan = valid;
              close();
              void store.applySplit(plan);
            }}
          >
            {valid.length}개 커밋 만들기
          </Button>
        </>
      }
    >
      {store.aiNotice && <span className="hint">{store.aiNotice}</span>}
      {groups.map((g, i) =>
        g.files.length === 0 ? null : (
          <div key={g.id} className="form-section" style={{ gap: 6 }}>
            <div className="row">
              <span className="form-section-title">{i + 1}번 커밋</span>
              <span className="muted">{g.files.length}개 파일</span>
              <span className="spacer" />
              <IconButton small icon={<ArrowUp size={13} />} tip="위로" disabled={i === 0} onClick={() => shift(i, -1)} />
              <IconButton small icon={<ArrowDown size={13} />} tip="아래로" disabled={i === groups.length - 1} onClick={() => shift(i, 1)} />
            </div>
            <textarea
              className="textarea"
              style={{ height: 58, fontSize: 12.5 }}
              value={g.message}
              placeholder="커밋 메시지 (첫 줄이 요약)"
              onChange={(e) => update(g.id, (x) => ({ ...x, message: e.target.value }))}
              spellCheck={false}
            />
            {g.files.map((p) => fileRow(p, g.id))}
          </div>
        ),
      )}
      {leftover.length > 0 && (
        <div className="form-section" style={{ gap: 6, opacity: 0.85 }}>
          <span className="form-section-title">커밋하지 않음</span>
          {leftover.map((p) => fileRow(p, null))}
        </div>
      )}
    </Modal>
  );
}
