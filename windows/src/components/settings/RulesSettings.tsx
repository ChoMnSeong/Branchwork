import { ai, aiProviders, instructionInfo, providerById, type AIFeature, type AIProviderId } from "../../lib/ai";
import { useObserve } from "../../lib/observable";
import { t } from "../../lib/i18n";

/** AI 규칙: 공통 규칙 + 기능별 규칙(커밋 메시지·커밋 설명·PR), 기능마다 쓸 AI */
export function RulesSettings() {
  useObserve(ai);
  return (
    <div className="col" style={{ gap: 14 }}>
      <span className="hint">
        {t("Write the rules the AI should follow when writing. For example:")}{" "}<code>{t("The prefix is one of Feature, Fix, Hotfix")}</code>{t(". Click a button to add a common rule as a new line.")}</span>
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
            data-tip={t("AI for this feature|Leave empty to use the default AI chosen in Settings > AI")}
          >
            <option value="">{t("Default AI ({0})", providerById(ai.provider).title.split(" (")[0])}</option>
            {aiProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title.split(" (")[0]}
                {ai.problem(p.id) ? t(" — not ready") : ""}
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
        placeholder={info.id === "commit" ? t("1. Write in English\n2. Capitalize the first letter of the prefix\n3. Use one of Feature, Fix, Hotfix, Refactoring, Style, Chore, Remove as the prefix") : t("One rule per line")}
        onChange={(e) => ai.setInstructions(info.id, e.target.value)}
        spellCheck={false}
      />
      <span className="hint">{info.detail}</span>
    </div>
  );
}
