import { CircleCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import { ai, aiProviders, providerById, type AIProviderId } from "../../lib/ai";
import { displayPath, isWindows } from "../../lib/env";
import { ipc } from "../../lib/ipc";
import { useObserve } from "../../lib/observable";
import { tools } from "../../lib/tools";
import { Button, Spinner } from "../shared/ui";

export function AISettings() {
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
