// 자동 점검용 가짜 AI 서버(OpenAI 호환): /v1/models, /v1/chat/completions
import http from "node:http";

const port = Number(process.argv[2] ?? 18080);
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        const j = JSON.parse(body || "{}");
        const sys = j.messages?.[0]?.content ?? "";
        const user = j.messages?.[1]?.content ?? "";
        // 커밋 메시지 요청이면 diff 안의 파일 이름을 넣어 돌려준다(요청이 제대로 왔는지 확인용)
        const file = (user.match(/b\/(\S+)/) ?? [])[1] ?? "unknown";
        // 사용자 규칙이 함께 왔는지 확인용: 규칙에 RULE-TEST 가 있으면 "Rule:" 로 시작
        const prefix = sys.includes("RULE-TEST") ? "Rule: " : "";
        let text = "OK";
        if (sys.includes("split a set of uncommitted")) {
          // 나눠서 커밋: 확장자별로 묶는다
          const files = [...user.matchAll(/^- (\S+)/gm)].map((m) => m[1]);
          const byExt = {};
          for (const f of files) (byExt[f.split(".").pop()] ??= []).push(f);
          text = JSON.stringify({ commits: Object.entries(byExt).map(([ext, fs]) => ({ message: `${prefix}${ext} 파일 정리`, files: fs })) });
        } else if (sys.includes("commit messages")) {
          text = `${prefix}가짜 AI 커밋: ${file}\n\n모델 ${j.model}`;
        }
        return res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`mock AI on ${port}`));
