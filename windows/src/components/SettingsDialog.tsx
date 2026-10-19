import { CircleCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import { accounts, AccountStore, type ClaudeMode } from "../lib/accounts";
import * as Claude from "../lib/claude";
import { displayPath, isWindows } from "../lib/env";
import { ipc } from "../lib/ipc";
import { accountHost, type HostAccount, type Provider } from "../lib/models";
import { useObserve } from "../lib/observable";
import { Avatar, Button, Modal, Segmented, Spinner } from "./ui";

/** Ctrl+, 설정: 계정(GitHub·GitLab)과 Claude */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"accounts" | "claude">("accounts");
  return (
    <Modal title="설정" width={620} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "accounts", label: "계정" },
          { value: "claude", label: "Claude" },
        ]}
      />
      <div style={{ minHeight: 420 }}>{tab === "accounts" ? <AccountsSettings /> : <ClaudeSettings />}</div>
    </Modal>
  );
}

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

function ClaudeSettings() {
  useObserve(accounts);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await Claude.complete("Reply with exactly: OK", "ping", "low");
      setResult("✅ 응답: " + r.slice(0, 40));
    } catch (e) {
      setResult("❌ " + (e instanceof Error ? e.message : String(e)));
    }
    setTesting(false);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <Segmented<ClaudeMode>
        value={accounts.claudeMode}
        onChange={(m) => accounts.setClaudeMode(m)}
        options={[
          { value: "cli", label: "Claude Code (이 PC 의 로그인 사용)" },
          { value: "api", label: "Anthropic API 키" },
        ]}
      />
      {accounts.claudeMode === "cli" ? (
        <div className="form-section">
          <span className="form-section-title">Claude Code</span>
          <div className="form-row">
            <label>실행 파일</label>
            <span className="ellipsis">{accounts.cliPath ? displayPath(accounts.cliPath) : "찾지 못함"}</span>
          </div>
          <div className="form-row">
            <label>모델</label>
            <select className="select" value={accounts.claudeCLIModel} onChange={(e) => accounts.setClaudeCLIModel(e.target.value)}>
              <option value="">Claude Code 기본값</option>
              {Claude.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <span className="hint">이 PC 에서 로그인한 Claude Code 계정을 그대로 씁니다. 도구는 모두 끈 채 글만 생성합니다.</span>
        </div>
      ) : (
        <div className="form-section">
          <span className="form-section-title">Anthropic API</span>
          {accounts.hasClaudeKey ? (
            <div className="row">
              <KeyRound size={14} /> <span className="grow">API 키 저장됨</span>
              <Button size="small" onClick={() => void accounts.setClaudeKey("")}>
                삭제
              </Button>
            </div>
          ) : (
            <div className="row">
              <input className="input" type="password" value={key} placeholder="API 키 (sk-ant-…)" onChange={(e) => setKey(e.target.value)} />
              <Button
                disabled={!key.trim()}
                onClick={() =>
                  void accounts.setClaudeKey(key).then(() => {
                    setKey("");
                  })
                }
              >
                저장
              </Button>
            </div>
          )}
          <div className="form-row">
            <label>모델</label>
            <select className="select" value={accounts.claudeModel} onChange={(e) => accounts.setClaudeModel(e.target.value)}>
              {Claude.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <span className="hint">요청이 안전 분류기에 막히면 서버가 권장 모델로 한 번 더 시도하도록(fallbacks) 켜 두었습니다.</span>
        </div>
      )}
      <div className="row">
        <Button disabled={testing} onClick={() => void test()}>
          연결 테스트
        </Button>
        {testing && <Spinner />}
        {result && <span style={{ fontSize: 12 }}>{result}</span>}
      </div>
      <span className="hint">커밋 메시지 작성, 커밋 설명, PR 설명 작성에 쓰이며 그때 변경 내용(diff)이 Claude 로 전송됩니다.</span>
    </div>
  );
}
