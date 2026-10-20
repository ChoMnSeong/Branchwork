import { CircleCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import { accounts, AccountStore } from "../lib/accounts";
import { ai, aiProviders, providerById, type AIProviderId } from "../lib/ai";
import { dirname, displayPath, isWindows } from "../lib/env";
import { ipc } from "../lib/ipc";
import { accountHost, type HostAccount, type Provider } from "../lib/models";
import { useObserve } from "../lib/observable";
import { toolList, tools, type ToolId } from "../lib/tools";
import { Avatar, Button, Modal, Segmented, Spinner } from "./ui";

/** Ctrl+, 설정: 계정(GitHub·GitLab), AI, 도구(실행 파일 위치) */
export function SettingsDialog({ onClose, initialTab = "accounts" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <Modal title="설정" width={640} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "accounts", label: "계정" },
          { value: "ai", label: "AI" },
          { value: "tools", label: "도구" },
        ]}
      />
      <div style={{ minHeight: 420 }}>{tab === "accounts" ? <AccountsSettings /> : tab === "ai" ? <AISettings /> : <ToolsSettings />}</div>
    </Modal>
  );
}

export type SettingsTab = "accounts" | "ai" | "tools";

function AccountsSettings() {
  useObserve(accounts);
  const [githubToken, setGithubToken] = useState("");
  const [gitlabServer, setGitlabServer] = useState(accounts.suggestedGitLabServer);
  const [gitlabToken, setGitlabToken] = useState("");
  const [working, setWorking] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (p: Provider, work: () => Promise<unknown>) => {
    setWorking(p);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setWorking(null);
  };
  const count = (p: Provider) => (accounts.accountsFor(p).length ? ` · ${accounts.accountsFor(p).length}개` : "");
  const gitlabTokenURL = gitlabServer.trim() ? AccountStore.normalizeServer(gitlabServer) + "/-/user_settings/personal_access_tokens?name=Branchwork&scopes=api" : null;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <span className="form-section-title">GitHub{count("github")}</span>
        {accounts.accountsFor("github").map((a) => (
          <ConnectedRow key={a.id} account={a} />
        ))}
        <input
          className="input"
          type="password"
          value={githubToken}
          placeholder={accounts.accountsFor("github").length ? "다른 계정의 토큰" : "Personal access token (ghp_…)"}
          onChange={(e) => setGithubToken(e.target.value)}
        />
        <div className="row">
          <Button
            disabled={!githubToken.trim() || !!working}
            onClick={() =>
              void run("github", async () => {
                await accounts.connectGitHub(githubToken);
                setGithubToken("");
              })
            }
          >
            {accounts.accountsFor("github").length ? "계정 추가" : "연결"}
          </Button>
          {accounts.ghPath && (
            <Button disabled={!!working} onClick={() => void run("github", () => accounts.importGitHubCLI())}>
              gh CLI 로그인 가져오기
            </Button>
          )}
          {working === "github" && <Spinner />}
          <span className="spacer" />
          <button className="link" onClick={() => void ipc.openUrl("https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Branchwork")}>
            토큰 만들기
          </button>
        </div>
        <span className="hint">계정을 여러 개 연결하면, 같은 서버의 저장소에서는 왼쪽 PR 목록 위에서 쓸 계정을 고를 수 있습니다.</span>
      </div>

      <div className="form-section">
        <span className="form-section-title">사내 GitLab (자체 호스팅){count("gitlab")}</span>
        {accounts.accountsFor("gitlab").map((a) => (
          <ConnectedRow key={a.id} account={a} showServer />
        ))}
        <input className="input" value={gitlabServer} placeholder="서버 주소 — https://gitlab.회사.co.kr" onChange={(e) => setGitlabServer(e.target.value)} spellCheck={false} />
        <input className="input" type="password" value={gitlabToken} placeholder="Personal access token (api 권한)" onChange={(e) => setGitlabToken(e.target.value)} />
        <div className="row">
          <Button
            disabled={!gitlabServer.trim() || !gitlabToken.trim() || !!working}
            onClick={() =>
              void run("gitlab", async () => {
                await accounts.connectGitLab(gitlabServer, gitlabToken);
                setGitlabToken("");
              })
            }
          >
            {accounts.accountsFor("gitlab").length ? "계정 추가" : "연결"}
          </Button>
          {working === "gitlab" && <Spinner />}
          <span className="spacer" />
          {gitlabTokenURL && (
            <button className="link" onClick={() => void ipc.openUrl(gitlabTokenURL)}>
              토큰 만들기
            </button>
          )}
        </div>
        <span className="hint">회사에서 운영하는 GitLab 서버만 연결합니다(gitlab.com 은 아직 지원하지 않음). 서버마다 여러 계정을 연결할 수 있습니다.</span>
      </div>

      {error && <span className="error-text">{error}</span>}
      <span className="hint">
        토큰은 {isWindows() ? "Windows 자격 증명 관리자" : "키체인"}에 계정별로 저장되고 PR·MR 조회와 생성, 저장소 목록, HTTPS push·pull 인증에 쓰입니다.
      </span>
    </div>
  );
}

function ConnectedRow({ account: a, showServer }: { account: HostAccount; showServer?: boolean }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <Avatar name={a.name ?? a.username} email={a.username} size={30} url={a.avatarURL} />
      <div className="col grow">
        <span style={{ fontWeight: 500 }}>{a.name ?? a.username}</span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          @{a.username}
          {showServer ? ` · ${accountHost(a)}` : ""}
        </span>
      </div>
      <span className="row" style={{ color: "var(--green)", fontSize: 12 }}>
        <CircleCheck size={13} /> 연결됨
      </span>
      <Button size="small" onClick={() => void accounts.disconnect(a)}>
        연결 해제
      </Button>
    </div>
  );
}

function AISettings() {
  useObserve(ai);
  useObserve(tools);
  const [id, setId] = useState<AIProviderId>(ai.provider);
  const p = providerById(id);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = (v: AIProviderId) => {
    setId(v);
    setModels([]);
    setResult(null);
    setError(null);
    setKey("");
  };
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await ai.complete("Reply with exactly: OK", "ping", "low", id);
      setResult("✅ 응답: " + r.slice(0, 40));
    } catch (e) {
      setResult("❌ " + (e instanceof Error ? e.message : String(e)));
    }
    setTesting(false);
  };
  const fetchModels = async () => {
    setListing(true);
    setError(null);
    try {
      const list = await ai.listModels(id);
      setModels(list);
      if (!list.length) setError("받은 모델이 없습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setListing(false);
  };
  const toolPath = p.tool ? tools.path(p.tool) : null;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <span className="form-section-title">커밋 메시지·커밋 설명·PR 본문을 쓸 AI</span>
        <div className="col" style={{ gap: 4 }}>
          {aiProviders.map((x) => {
            const problem = ai.problem(x.id);
            return (
              <label key={x.id} className="row" style={{ gap: 8, padding: "3px 0" }}>
                <input type="radio" name="ai" checked={id === x.id} onChange={() => select(x.id)} style={{ accentColor: "var(--accent)" }} />
                <span className="grow">{x.title}</span>
                {ai.provider === x.id ? (
                  <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
                    사용 중
                  </span>
                ) : (
                  !problem && <span className="faint" style={{ fontSize: 11 }}>준비됨</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div className="form-section">
        <div className="row">
          <span className="form-section-title grow">{p.title}</span>
          {ai.provider === id ? (
            <span className="row" style={{ color: "var(--green)", fontSize: 12 }}>
              <CircleCheck size={13} /> 이 AI 를 쓰는 중
            </span>
          ) : (
            <Button size="small" kind="primary" onClick={() => ai.setProvider(id)}>
              이 AI 쓰기
            </Button>
          )}
        </div>
        {p.kind === "cli" && (
          <div className="form-row">
            <label>실행 파일</label>
            <span className="ellipsis">{toolPath ? displayPath(toolPath) : <span className="error-text">찾지 못함 — 도구 탭에서 불러오세요</span>}</span>
          </div>
        )}
        {id === "compatible" && (
          <div className="form-row">
            <label>서버 주소</label>
            <input className="input" defaultValue={ai.baseURL} placeholder="http://localhost:11434/v1" onBlur={(e) => ai.setBaseURL(e.target.value)} spellCheck={false} />
          </div>
        )}
        {p.kind === "api" && (
          <div className="form-row">
            <label>API 키</label>
            {ai.hasKey[id] ? (
              <div className="row">
                <KeyRound size={14} /> <span className="grow">저장됨</span>
                <Button size="small" onClick={() => void ai.setKey(id, "")}>
                  삭제
                </Button>
              </div>
            ) : (
              <div className="row">
                <input className="input" type="password" value={key} placeholder={p.keyHint} onChange={(e) => setKey(e.target.value)} />
                <Button disabled={!key.trim()} onClick={() => void ai.setKey(id, key).then(() => setKey(""))}>
                  저장
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="form-row">
          <label>모델</label>
          <div className="row">
            <input className="input" list={`models-${id}`} value={ai.models[id] ?? p.defaultModel} placeholder={p.modelHint} onChange={(e) => ai.setModel(id, e.target.value)} spellCheck={false} />
            <datalist id={`models-${id}`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {p.kind === "api" && (
              <Button size="small" disabled={listing} onClick={() => void fetchModels()} tip="모델 목록 불러오기|이 키로 쓸 수 있는 모델을 받아 옵니다">
                {listing ? <Spinner size={11} /> : "목록"}
              </Button>
            )}
          </div>
        </div>
        {models.length > 0 && <span className="hint">모델 {models.length}개를 받았습니다. 모델 칸을 누르면 고를 수 있습니다.</span>}
        {error && <span className="error-text">{error}</span>}
        <span className="hint">{p.note}</span>
        <div className="row">
          {p.keyURL && (
            <button className="link" onClick={() => void ipc.openUrl(p.keyURL!)}>
              키 만들기
            </button>
          )}
          <span className="spacer" />
          {testing && <Spinner />}
          <Button disabled={testing} onClick={() => void test()}>
            연결 테스트
          </Button>
        </div>
        {result && <span style={{ fontSize: 12, wordBreak: "break-word" }}>{result}</span>}
      </div>
      <span className="hint">고른 AI 로 변경 내용(diff)이 전송됩니다. 키는 {isWindows() ? "Windows 자격 증명 관리자" : "키체인"}에 저장됩니다.</span>
    </div>
  );
}

function ToolsSettings() {
  useObserve(tools);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ToolId | null>(null);
  const load = async (id: ToolId, title: string) => {
    setError(null);
    const current = tools.path(id);
    const picked = await ipc.pickFile(`${title} 실행 파일 선택`, current ? dirname(current) : undefined);
    if (!picked) return;
    setBusy(id);
    try {
      await tools.setCustom(id, picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="hint">
        PC 마다 설치 위치가 달라 자동으로 못 찾으면 <b>불러오기</b>로 실행 파일을 직접 고르세요. 고른 경로는 저장되어 다음에도 그대로 씁니다.
      </span>
      {toolList.map((t) => {
        const st = tools.state[t.id];
        return (
          <div key={t.id} className="form-section" style={{ gap: 6, padding: 10 }}>
            <div className="row">
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              {t.required && <span className="faint" style={{ fontSize: 11 }}>필수</span>}
              <span className="spacer" />
              {st.source === "custom" && <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>직접 지정</span>}
              {st.source === "auto" && <span className="faint" style={{ fontSize: 11 }}>자동으로 찾음</span>}
              {st.source === "none" && <span className="chip-warn">없음</span>}
            </div>
            <span className="hint">{t.detail}</span>
            <div className="row">
              <span className="ellipsis grow mono" style={{ fontSize: 11.5 }}>
                {st.path ? displayPath(st.path) : "—"}
              </span>
              {busy === t.id && <Spinner size={12} />}
              <Button size="small" onClick={() => void load(t.id, t.title)}>
                불러오기…
              </Button>
              {st.source === "custom" && (
                <Button size="small" onClick={() => void tools.resetToAuto(t.id)} tip="직접 고른 경로를 지우고 다시 자동으로 찾습니다">
                  자동
                </Button>
              )}
              {st.source === "none" && t.install && (
                <button className="link" onClick={() => void ipc.openUrl(t.install!)}>
                  설치
                </button>
              )}
            </div>
            {st.version && <span className="faint" style={{ fontSize: 11 }}>{st.version}</span>}
          </div>
        );
      })}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
