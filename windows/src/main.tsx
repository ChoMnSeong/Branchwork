import { createRoot } from "react-dom/client";
import { App } from "./App";
import { accounts } from "./lib/accounts";
import { agents } from "./lib/agents";
import { initEnv } from "./lib/env";
import { ai } from "./lib/ai";
import { gitAvailable } from "./lib/git";
import { tools } from "./lib/tools";
import { updater } from "./lib/updater";
import { ipc } from "./lib/ipc";
import { settings } from "./lib/settings";
import { workspace } from "./lib/workspace";
import { runSelfTest } from "./selftest";
import "./styles.css";

// 웹뷰 기본 우클릭 메뉴(새로 고침·검사 등)는 끄고, 앱 메뉴만 쓴다(입력 칸은 그대로)
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea, .xterm, .selectable")) e.preventDefault();
});

async function boot() {
  await initEnv();
  await settings.load();
  await tools.detectAll();
  await Promise.all([accounts.load(), ai.load(), agents.init()]);
  const git = gitAvailable();
  createRoot(document.getElementById("root")!).render(<App gitMissing={!git} />);
  // 첫 화면(로딩 애니메이션)이 그려진 뒤 창을 보여 준다 — 흰 화면 번쩍임 없이.
  // 숨긴 창에서는 requestAnimationFrame 이 돌지 않으므로 타이머로 부른다.
  setTimeout(() => void ipc.appReady(), 30);
  updater.start();
  window.addEventListener("beforeunload", () => void settings.flush());
  if (git) {
    const test = await runSelfTest();
    if (!test) await workspace.restore();
  } else {
    await workspace.restore();
  }
}

void boot().catch((e) => {
  document.body.innerHTML = `<pre style="padding:20px;white-space:pre-wrap">Branchwork 를 시작하지 못했습니다\n\n${String(e?.stack ?? e)}</pre>`;
  void ipc.appReady();
});
