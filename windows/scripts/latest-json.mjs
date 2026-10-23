// 릴리스용 latest.json(자동 업데이트 목록) 만들기
//   node scripts/latest-json.mjs <버전> <setup.exe 이름> <.sig 파일> <릴리스 노트 파일> > latest.json
import fs from "node:fs";

const [version, setupName, sigFile, notesFile] = process.argv.slice(2);
if (!version || !setupName || !sigFile) {
  console.error("사용법: node scripts/latest-json.mjs <버전> <setup.exe 이름> <.sig 파일> [릴리스 노트 파일]");
  process.exit(1);
}
const url = `https://github.com/Gitrochi/Gitrochi/releases/download/v${version}/${encodeURIComponent(setupName)}`;
const entry = { signature: fs.readFileSync(sigFile, "utf8").trim(), url };
const out = {
  version,
  notes: notesFile ? fs.readFileSync(notesFile, "utf8").trim() : "",
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: { "windows-x86_64": entry, "windows-x86_64-nsis": entry },
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
