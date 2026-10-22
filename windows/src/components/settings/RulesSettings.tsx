import { ai, aiProviders, instructionInfo, providerById, type AIFeature, type AIProviderId } from "../../lib/ai";
import { useObserve } from "../../lib/observable";

/** AI 규칙: 공통 규칙 + 기능별 규칙(커밋 메시지·커밋 설명·PR), 기능마다 쓸 AI */
export function RulesSettings() {
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
