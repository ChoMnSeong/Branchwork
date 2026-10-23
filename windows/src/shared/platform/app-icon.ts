import { Image } from "@tauri-apps/api/image";
import { join, resourceDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import shadow from "@/shared/assets/app-icons/shadow.png";
import standard from "@/shared/assets/icon.png";
import { ipc } from "@/shared/api";
import { env, isWindows, settings } from "@/shared/config";
import { t } from "@/shared/i18n";

export interface AppIconOption {
  id: string;
  title: string;
  /** 설정 화면 미리 보기 · 창 아이콘(256 PNG) */
  image: string;
}

/**
 * 앱 아이콘(설정 > 화면). 새 아이콘은 ../assets/app-icons/<id>.png(1024)를 넣고 node scripts/app-icons.mjs 로
 * .ico·미리 보기를 만든 뒤, 여기와 맥(macos/Sources/App/AppIcon.swift)에 한 줄씩 더한다.
 */
export const appIconOptions: AppIconOption[] = [
  { id: "default", title: t("Default"), image: standard },
  { id: "shadow", title: t("Shadow"), image: shadow },
];

const KEY = "appIcon";
/** 바로 가기에 마지막으로 넣은 아이콘과 그때 버전(업데이트로 다시 설치되면 바로 가기가 기본 아이콘으로 돌아간다) */
const SHORTCUTS_KEY = "appIconShortcuts";

// 시작 메뉴·바탕 화면·작업 표시줄 고정 폴더에서 이 exe 를 가리키는 .lnk 의 아이콘을 바꾸고, 바꾼 개수를 출력한다.
// 경로는 스크립트 글자에 이어 붙이지 않고 환경 변수로 넘긴다.
const SHORTCUT_SCRIPT = `
$exe = $env:BW_EXE; $icon = "$($env:BW_ICON),0"
$dirs = if ($env:BW_DIRS) { $env:BW_DIRS -split '\\|' } else { @(
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')) }
$shell = New-Object -ComObject WScript.Shell
$n = 0
foreach ($d in $dirs) {
  if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
  foreach ($f in Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -Depth 1 -ErrorAction SilentlyContinue) {
    $l = $shell.CreateShortcut($f.FullName)
    if ($l.TargetPath -ieq $exe -and $l.IconLocation -ne $icon) { $l.IconLocation = $icon; $l.Save(); $n++ }
  }
}
if ($n -gt 0) { Start-Process ie4uinit.exe -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue }
$n
`;

const option = (id: string) => appIconOptions.find((o) => o.id === id) ?? appIconOptions[0];

export const appIcon = {
  /** 고른 아이콘. 목록에서 빠진 아이콘을 골라 두었으면 기본 */
  get current(): AppIconOption {
    return option(settings.get<string>(KEY, "default"));
  },

  /** 고르고 바로 적용: 창·작업 표시줄 아이콘, 그리고 시작 메뉴·바탕 화면·작업 표시줄에 고정한 바로 가기 */
  async select(id: string) {
    settings.set(KEY, option(id).id);
    await this.setWindowIcon(id);
    await this.updateShortcuts(id);
  },

  /** 켤 때: 창 아이콘을 다시 걸고, 버전이 바뀌었으면(다시 설치되어 바로 가기가 기본으로 돌아갔을 수 있다) 바로 가기도 다시 맞춘다 */
  async restore() {
    const icon = this.current;
    if (icon.id !== "default") await this.setWindowIcon(icon.id).catch(() => {});
    const last = settings.get<{ version: string; id: string } | null>(SHORTCUTS_KEY, null);
    const stale = icon.id === "default" ? !!last && last.id !== "default" : last?.id !== icon.id || last?.version !== env.version;
    if (stale) await this.updateShortcuts(icon.id).catch(() => {});
  },

  /** 창(제목 표시줄·작업 표시줄 단추) 아이콘. PNG 를 화면에서 풀어 RGBA 로 넘긴다(Rust 쪽 PNG 기능 없이). */
  async setWindowIcon(id: string) {
    const bitmap = await createImageBitmap(await (await fetch(option(id).image)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const image = await Image.new(new Uint8Array(rgba.buffer), bitmap.width, bitmap.height);
    try {
      await getCurrentWindow().setIcon(image);
    } finally {
      void image.close();
    }
  },

  /**
   * 이 exe 를 가리키는 바로 가기의 아이콘을 바꾸고 바꾼 개수를 돌려준다. 기본이면 exe 안의 아이콘으로 되돌린다.
   * dirs 를 주면 그 폴더들만 본다(자동 점검용). 설치본이 아니라 .ico 가 없으면(포터블) 0.
   */
  async updateShortcuts(id: string, dirs?: string[]) {
    if (!isWindows() || !env.exe) return 0;
    const icon = option(id);
    // 바로 가기 아이콘 경로에는 \\?\ 접두어를 쓰지 않는다
    const location = (icon.id === "default" ? env.exe : await join(await resourceDir(), "icons", "app", `${icon.id}.ico`)).replace(/^\\\\\?\\/, "");
    if (!(await ipc.exists(location))) return 0;
    const r = await ipc.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SHORTCUT_SCRIPT], {
      env: { BW_EXE: env.exe, BW_ICON: location, BW_DIRS: (dirs ?? []).join("|") },
      timeoutMs: 30000,
    });
    if (r.status !== 0) throw new Error(t("Couldn't change the shortcut icons: {0}", r.stderr.trim() || `exit ${r.status}`));
    if (!dirs) settings.set(SHORTCUTS_KEY, { version: env.version, id: icon.id });
    return Number(r.stdout.trim().split(/\s+/).pop()) || 0;
  },
};
