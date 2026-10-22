import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { accounts, AccountStore } from "../../lib/accounts";
import { isWindows } from "../../lib/env";
import { ipc } from "../../lib/ipc";
import { accountHost, type HostAccount, type Provider } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import { avatars } from "../../lib/avatars";
import { Avatar, Button, Checkbox, Spinner } from "../shared/ui";

export function AccountsSettings() {
  useObserve(accounts);
  useObserve(avatars);
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

      <div className="form-section">
        <span className="form-section-title">커밋 그래프</span>
        <Checkbox checked={avatars.enabled} onChange={(v) => avatars.setEnabled(v)} label="작성자 프로필 사진 보이기" />
        <span className="hint">GitHub 프로필 → 연결한 사내 GitLab 프로필 → Gravatar 순으로 찾고, 없으면 이니셜을 씁니다. Gravatar 에는 이메일 해시가 전송됩니다.</span>
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
