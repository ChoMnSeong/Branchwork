// 앱 아이콘(설정 > 화면 > 앱 아이콘)의 Windows 파일 만들기: ../assets/app-icons/<id>.png(1024 원본)마다
//   src-tauri/icons/app/<id>.ico          바로 가기 아이콘(여러 크기, 설치 폴더에 함께 들어감)
//   src/shared/assets/app-icons/<id>.png  설정 화면 미리 보기 · 창 아이콘(256)
//   node scripts/app-icons.mjs   (windows 폴더에서, npm ci 뒤)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masters = path.resolve(root, "..", "assets", "app-icons");
const icoDir = path.join(root, "src-tauri", "icons", "app");
const thumbDir = path.join(root, "src", "shared", "assets", "app-icons");
fs.mkdirSync(icoDir, { recursive: true });
fs.mkdirSync(thumbDir, { recursive: true });

for (const name of fs.readdirSync(masters).filter((f) => f.endsWith(".png")).sort()) {
  const id = name.slice(0, -".png".length);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "branchwork-icon-"));
  try {
    // tauri icon 이 만드는 것 중 icon.ico 와 256 PNG 만 쓴다
    execFileSync("npx", ["tauri", "icon", path.join(masters, name), "-o", out], { cwd: root, stdio: "ignore", shell: process.platform === "win32" });
    fs.copyFileSync(path.join(out, "icon.ico"), path.join(icoDir, `${id}.ico`));
    fs.copyFileSync(path.join(out, "128x128@2x.png"), path.join(thumbDir, `${id}.png`));
    console.log(`✅ ${id}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
