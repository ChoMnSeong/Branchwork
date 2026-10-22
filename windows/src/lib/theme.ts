import { getCurrentWindow } from "@tauri-apps/api/window";
import { Observable } from "./observable";
import { settings } from "./settings";

export type ThemeMode = "system" | "light" | "dark";

export const themeModes: { id: ThemeMode; title: string }[] = [
  { id: "system", title: "시스템" },
  { id: "light", title: "라이트" },
  { id: "dark", title: "다크" },
];

/**
 * 화면 테마: Windows 설정을 따르거나 라이트·다크로 고정(설정 > 화면). (맥 버전 AppTheme)
 * <html data-theme="light|dark"> 로 CSS 색을 고르고, 창 제목 표시줄도 같은 테마로 맞춘다.
 */
class ThemeStore extends Observable {
  private media = matchMedia("(prefers-color-scheme: dark)");

  get mode(): ThemeMode {
    return settings.get<ThemeMode>("theme", "system");
  }

  get isDark() {
    return this.mode === "dark" || (this.mode === "system" && this.media.matches);
  }

  /** 설정을 읽은 뒤, 첫 화면을 그리기 전에 한 번 */
  init() {
    this.media.addEventListener("change", () => {
      if (this.mode === "system") this.apply();
    });
    this.apply();
  }

  setMode(mode: ThemeMode) {
    settings.set("theme", mode);
    this.apply();
  }

  private apply() {
    document.documentElement.dataset.theme = this.isDark ? "dark" : "light";
    void getCurrentWindow()
      .setTheme(this.mode === "system" ? null : this.mode)
      .catch(() => undefined);
    this.emit();
  }
}

export const theme = new ThemeStore();
