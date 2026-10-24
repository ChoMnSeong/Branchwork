// gitch graph html 을 헤드리스 Chrome 으로 열어 본다(외부 모듈 없이 CDP — Node 22 의 fetch · WebSocket).
// 사용: node graph_browser.mjs <chrome> <html> <임시 폴더> → JSON 한 줄. 페이지 오류가 있거나 겹친 노드가 있으면 종료 코드 1
import { spawn } from "node:child_process";

const [chromePath, html, tmp] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${tmp}/chrome`, "--no-first-run",
  "--no-default-browser-check", "--disable-gpu", "--allow-file-access-from-files", "--use-mock-keychain", "--password-store=basic", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const waiting = new Map(), errors = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : r.result.exceptionDetails.text);
  return r.result.result.value;
}
// 배치를 바꾸고 멈출 때까지 기다린 뒤 겹친 쌍의 수
const settle = (tab, layout, style) => `(async () => {
  const t = window.gitchGraphTest, click = (sel) => { const b = document.querySelector(sel); if (b && !b.classList.contains("on")) b.click(); };
  if (${JSON.stringify(tab)}) document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(tab)} }));
  if (${JSON.stringify(style)}) click('#style button[data-v="${style}"]');
  click('#layout button[data-v="${layout}"]');
  const t0 = performance.now();
  while (t.state().running && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 700));
  const s = t.state();
  return { rel: s.rel, layout: s.layout, style: s.style, nodes: s.nodes, overlaps: t.overlaps() };
})()`;
let out = { ok: false };
try {
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
    } catch (e) { ws = undefined; }
    if (!ws) await sleep(100);
  }
  if (!ws) throw new Error("Chrome 이 뜨지 않음");
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `file://${html}#test` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate("!!window.gitchGraphTest")) break; }
  const checks = [];
  for (const [tab, layout, style] of [["", "force", "dot"], ["", "force", "box"], ["", "pack", ""], ["", "layers", "box"], ["2", "layers", "box"], ["2", "force", "box"], ["4", "tidy", "box"], ["4", "radial", "dot"], ["4", "pack", ""]])
    checks.push(await evaluate(settle(tab, layout, style)));
  const png = await evaluate(`new Promise((res) => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = orig; fetch(this.href).then((x) => x.blob()).then((b) => res({ name: this.download, type: b.type, bytes: b.size })); }; document.getElementById("png").click(); })`);
  out = { ok: !errors.length && checks.every((c) => c.overlaps === 0) && png.type === "image/png", errors, checks, png };
} catch (e) {
  out = { ok: false, errors: [...errors, String(e && e.message || e)] };
} finally {
  try { ws && ws.close(); } catch (e) { /* 이미 닫힘 */ }
  chrome.kill("SIGTERM");
}
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
