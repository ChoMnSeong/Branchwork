import { env, initEnv } from "./lib/env";
import { loadLanguage, t } from "./lib/i18n";
import { ipc } from "./lib/ipc";
import { settings } from "./lib/settings";

// 화면 언어를 먼저 정하고 나서 앱을 불러온다(앱 모듈의 글자가 그 언어로 읽히게).
// 자체 점검·README 스크린샷은 한국어 화면을 기준으로 한다.
async function boot() {
  await initEnv();
  await settings.load();
  await loadLanguage(env.selftest ? "ko" : settings.get<string | null>("language", null));
  const { start } = await import("./start");
  await start();
}

void boot().catch((e) => {
  const pre = document.createElement("pre");
  pre.style.cssText = "padding:20px;white-space:pre-wrap";
  pre.textContent = `${t("Couldn't start Branchwork")}\n\n${String(e?.stack ?? e)}`;
  document.body.replaceChildren(pre);
  void ipc.appReady();
});
