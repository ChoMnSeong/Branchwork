import { useState } from "react";
import { workspace } from "@/entities/workspace";
import { settings } from "@/shared/config";
import { defaultLanguage, languages, t } from "@/shared/i18n";
import { useObserve } from "@/shared/lib";
import { appIcon, appIconOptions } from "@/shared/platform";
import { Segmented, theme, themeModes } from "@/shared/ui";

/** 화면: 언어, 테마(시스템·라이트·다크), 앱 아이콘 */
export function AppearanceSettings() {
  useObserve(theme);
  useObserve(settings);
  const choice = settings.get<string>("language", defaultLanguage);
  const [iconError, setIconError] = useState<string | null>(null);
  const icon = appIcon.current.id;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <span className="form-section-title">{t("Language")}</span>
        <select
          className="select"
          style={{ width: 260 }}
          value={choice}
          onChange={async (e) => {
            settings.set("language", e.target.value);
            await settings.flush();
            // 화면 글자는 시작할 때 정하므로 창을 다시 불러온다(열린 탭은 다시 열린다). 터미널 셸은 남지 않게 먼저 끝낸다.
            for (const tab of workspace.tabs) for (const term of tab.terminals) term.terminate();
            window.location.reload();
          }}
        >
          <option value="system">{t("Follow system language")}</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="hint">{t("The window reloads to apply the change. When there's no commit history to follow, the AI also writes in this language.")}</span>
      </div>
      <div className="form-section">
        <span className="form-section-title">{t("Theme")}</span>
        <Segmented value={theme.mode} onChange={(m) => theme.setMode(m)} options={themeModes.map((m) => ({ value: m.id, label: m.title }))} />
        <span className="hint">{t("System follows your Windows setting (app mode light or dark). The graph, terminal and title bar change with it.")}</span>
      </div>
      <div className="form-section">
        <span className="form-section-title">{t("App icon")}</span>
        <div className="row" style={{ gap: 12 }} role="radiogroup" aria-label={t("App icon")}>
          {appIconOptions.map((o) => {
            const selected = o.id === icon;
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={selected}
                title={o.title}
                onClick={() => {
                  setIconError(null);
                  appIcon.select(o.id).catch((e) => setIconError(e instanceof Error ? e.message : String(e)));
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: 6,
                  borderRadius: 12,
                  border: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
                  background: selected ? "var(--accent-soft)" : "transparent",
                  color: "inherit",
                  font: "inherit",
                  cursor: "pointer",
                }}
              >
                <img src={o.image} width={56} height={56} alt="" />
                <span style={{ fontSize: 12 }}>{o.title}</span>
              </button>
            );
          })}
        </div>
        <span className="hint">
          {t("Changes the icon on the window and taskbar, and on Branchwork's shortcuts in the Start menu, on the desktop and pinned to the taskbar. New icons come with updates.")}
        </span>
        {iconError && (
          <span className="hint" style={{ color: "var(--orange)" }}>
            {iconError}
          </span>
        )}
      </div>
    </div>
  );
}
