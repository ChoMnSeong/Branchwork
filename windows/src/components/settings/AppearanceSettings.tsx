import { useObserve } from "../../lib/observable";
import { theme, themeModes } from "../../lib/theme";
import { Segmented } from "../shared/ui";

/** 화면: 테마(시스템·라이트·다크) */
export function AppearanceSettings() {
  useObserve(theme);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <span className="form-section-title">테마</span>
        <Segmented value={theme.mode} onChange={(m) => theme.setMode(m)} options={themeModes.map((m) => ({ value: m.id, label: m.title }))} />
        <span className="hint">시스템은 Windows 설정(앱 모드 라이트·다크)을 따릅니다. 그래프·터미널·제목 표시줄까지 함께 바뀝니다.</span>
      </div>
    </div>
  );
}
