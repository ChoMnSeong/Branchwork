import { Globe, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { accounts } from "../../lib/accounts";
import { displayPath, env, isWindows, joinPath, slash } from "../../lib/env";
import * as Hosting from "../../lib/hosting";
import { ipc } from "../../lib/ipc";
import { accountApiBase, accountHost, type RemoteRepo } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Button, Spinner } from "../shared/ui";
import { Frame, Row } from "./Frame";

/** https://host/a/b.git, git@host:a/b.git → "b" */
function guessName(url: string) {
  const last = url.trim().split(/[/:]/).pop() ?? "";
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

export function CloneSheet({ store, close }: { store: RepoStore; close: () => void }) {
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
