import { CircleCheck, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { accounts, AccountStore } from "../lib/accounts";
import { ai, aiProviders, instructionInfo, providerById, type AIFeature, type AIProviderId } from "../lib/ai";
import { dirname, displayPath, isWindows } from "../lib/env";
import { ipc } from "../lib/ipc";
import { accountHost, type HostAccount, type Provider } from "../lib/models";
import { useObserve } from "../lib/observable";
import { toolList, tools, wslCapable, type ToolId } from "../lib/tools";
import { listDistros } from "../lib/wsl";
import { updater } from "../lib/updater";
import { settings } from "../lib/settings";
import { env } from "../lib/env";
import icon from "../assets/icon.png";
import { Avatar, Button, Checkbox, Modal, Segmented, showMenuBelow, Spinner } from "./ui";

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
          { value: "rules", label: "규칙" },
          { value: "tools", label: "도구" },
          { value: "about", label: "업데이트" },
        ]}
      />
      <div style={{ minHeight: 420 }}>
        {tab === "accounts" ? (
          <AccountsSettings />
        ) : tab === "ai" ? (
          <AISettings />
        ) : tab === "rules" ? (
          <RulesSettings />
        ) : tab === "tools" ? (
          <ToolsSettings />
        ) : (
          <AboutSettings />
        )}
      </div>
    </Modal>
  );
}

export type SettingsTab = "accounts" | "ai" | "rules" | "tools" | "about";

/** 버전과 자동 업데이트 */
function AboutSettings() {
  useObserve(updater);
  useObserve(settings);
  const status =
    updater.state === "checking"
      ? "확인하는 중…"
      : updater.state === "available"
        ? `새 버전 ${updater.info?.version} 이(가) 있습니다`
        : updater.state === "none"
          ? "최신 버전입니다"
          : updater.state === "error"
            ? `확인 실패: ${updater.error}`
            : "";
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <div className="row">
          <img src={icon} width={48} height={48} alt="" />
          <div className="col grow">
            <span style={{ fontSize: 16, fontWeight: 600 }}>Branchwork {env.version}</span>
            <span className="hint">Git 저장소를 그래프로 보고 다루는 앱 · MIT</span>
          </div>
          <button className="link" onClick={() => void ipc.openUrl("https://github.com/ChoMnSeong/Branchwork/releases")}>
            릴리스 노트
          </button>
        </div>
      </div>
      <div className="form-section">
        <span className="form-section-title">자동 업데이트</span>
        <Checkbox checked={updater.autoCheck} onChange={(v) => updater.setAutoCheck(v)} label="켤 때와 하루에 한 번 새 버전 확인" />
        <div className="row">
          <Button disabled={updater.state === "checking" || updater.state === "downloading"} onClick={() => void updater.check(true)}>
            지금 확인
          </Button>
          {updater.state === "checking" && <Spinner />}
          <span className="hint grow">{status}</span>
        </div>
        <span className="hint">새 버전이 있으면 알려 주고, 누르면 받아서 설치한 뒤 다시 시작합니다. 설치 파일은 Branchwork 서명이 맞을 때만 설치됩니다.</span>
      </div>
    </div>
  );
}

/** AI 규칙: 공통 규칙 + 기능별 규칙(커밋 메시지·커밋 설명·PR), 기능마다 쓸 AI */
function RulesSettings() {
  useObserve(ai);
  return (
    <div className="col" style={{ gap: 14 }}>
      <span className="hint">
        AI 가 글을 쓸 때 지킬 규칙을 적으세요. 예: <code>prefix 는 Feature, Fix, Hotfix 중 하나</code>. 버튼을 누르면 자주 쓰는 규칙이 한 줄 추가됩니다.
      </span>
      {instructionInfo.map((info) => (
        <RuleEditor key={info.id} info={info} />
      ))}
    </div>
  );
}

function RuleEditor({ info }: { info: (typeof instructionInfo)[number] }) {
  const value = ai.instructions[info.id] ?? "";
  const add = (chip: string) => {
    const base = value.replace(/\s+$/, "");
    const n = base ? base.split("\n").filter((l) => l.trim()).length : 0;
    const numbered = /^\s*1[.)]/.test(base);
    ai.setInstructions(info.id, (base ? base + "\n" : "") + (numbered ? `${n + 1}. ` : "") + chip);
  };
  return (
    <div className="form-section">
      <div className="row">
        <span className="form-section-title grow">{info.title}</span>
        {info.id !== "global" && (
          <select
            className="select"
            style={{ width: 230, height: 26, padding: "0 6px" }}
            value={ai.featureProvider[info.id as AIFeature] ?? ""}
            onChange={(e) => ai.setFeatureProvider(info.id as AIFeature, (e.target.value || null) as AIProviderId | null)}
            data-tip="이 기능에 쓸 AI|비우면 설정 > AI 에서 고른 기본 AI 를 씁니다"
          >
            <option value="">기본 AI ({providerById(ai.provider).title.split(" (")[0]})</option>
            {aiProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title.split(" (")[0]}
                {ai.problem(p.id) ? " — 준비 안 됨" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {info.chips.map((c) => (
          <button key={c} className="pill" style={{ fontFamily: "var(--font)", fontSize: 11.5 }} onClick={() => add(c)}>
            + {c}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        style={{ height: 92, fontSize: 12.5 }}
        value={value}
        placeholder={info.id === "commit" ? "1. 한글로 작성하기\n2. prefix의 맨 앞글자는 대문자로 작성하기\n3. prefix는 Feature, Fix, Hotfix, Refactoring, Style, Chore, Remove 중에 사용하기" : "규칙을 한 줄에 하나씩"}
        onChange={(e) => ai.setInstructions(info.id, e.target.value)}
        spellCheck={false}
      />
      <span className="hint">{info.detail}</span>
    </div>
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
  const toolPath = p.tool ? tools.describe(p.tool) : null;
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
  useObserve(settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  useEffect(() => {
    if (isWindows()) void listDistros().then(setDistros);
  }, []);
  const findInWsl = async (id: ToolId, distro: string) => {
    setError(null);
    setBusy(id);
    try {
      await tools.useWsl(id, distro);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
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
        const w = tools.wsl(t.id);
        const canWsl = wslCapable.includes(t.id) && distros.length > 0;
        return (
          <div key={t.id} className="form-section" style={{ gap: 6, padding: 10 }}>
            <div className="row">
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              {t.required && <span className="faint" style={{ fontSize: 11 }}>필수</span>}
              <span className="spacer" />
              {w ? (
                <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
                  WSL · {w.distro}
                </span>
              ) : (
                <>
                  {st.source === "custom" && <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>직접 지정</span>}
                  {st.source === "auto" && <span className="faint" style={{ fontSize: 11 }}>자동으로 찾음</span>}
                  {st.source === "none" && <span className="chip-warn">없음</span>}
                </>
              )}
            </div>
            <span className="hint">{t.detail}</span>
            <div className="row">
              <span className="ellipsis grow mono" style={{ fontSize: 11.5 }}>
                {w ? w.path : st.path ? (st.path.startsWith("wsl:") ? `WSL · ${st.path.slice(4)}` : displayPath(st.path)) : "—"}
              </span>
              {busy === t.id && <Spinner size={12} />}
              {!w && (
                <Button size="small" onClick={() => void load(t.id, t.title)}>
                  불러오기…
                </Button>
              )}
              {canWsl &&
                (w ? (
                  <Button size="small" onClick={() => tools.useWindows(t.id)} tip="WSL 대신 윈도에 설치된 것을 씁니다">
                    윈도 것 쓰기
                  </Button>
                ) : (
                  <Button
                    size="small"
                    tip={`WSL 에서 찾기|WSL(${distros[0]}) 안에 설치한 ${t.command} 를 찾아 씁니다. 배포판이 여럿이면 ▾`}
                    onClick={(e) =>
                      distros.length === 1
                        ? void findInWsl(t.id, distros[0])
                        : showMenuBelow(e.currentTarget, distros.map((d) => ({ label: `${d} 에서 찾기`, onClick: () => void findInWsl(t.id, d) })))
                    }
                  >
                    WSL 에서 찾기
                  </Button>
                ))}
              {t.id === "shell" && distros.length > 0 && (
                <Button
                  size="small"
                  tip="터미널을 WSL 배포판의 셸로 엽니다(저장소 폴더를 리눅스 경로로 바꿔서)"
                  onClick={(e) => showMenuBelow(e.currentTarget, distros.map((d) => ({ label: `WSL · ${d}`, onClick: () => tools.setShellWsl(d) })))}
                >
                  WSL 셸…
                </Button>
              )}
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
            {(w ? w.version : st.version) && <span className="faint" style={{ fontSize: 11 }}>{w ? w.version : st.version}</span>}
          </div>
        );
      })}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
