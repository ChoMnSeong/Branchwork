import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ai } from "../../lib/ai";
import { providerInfo } from "../../lib/models";
import type { RepoStore } from "../../lib/repo";
import { Button, Checkbox, Spinner } from "../shared/ui";
import { Frame } from "./Frame";

export function CreatePullRequestSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const provider = store.target?.provider ?? "github";
  const [title, setTitle] = useState(() => {
    const b = store.headBranch ?? "";
    return (b.split("/").pop() ?? b).replace(/-/g, " ");
  });
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [bases] = useState(() => store.pullRequestBaseCandidates());
  const [draft, setDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    void store.defaultBaseBranch().then((b) => b && setBase((cur) => cur || b));
  }, [store]);
  return (
    <Frame
      title={`새 ${providerInfo[provider].requestName}`}
      confirm="만들기"
      width={640}
      canConfirm={!!title.trim() && !!base}
      close={close}
      onConfirm={() => void store.createPullRequest(title.trim(), body, base, draft)}
      leftFooter={store.status.upstream == null || store.status.ahead > 0 ? `만들기 전에 현재 브랜치를 ${store.target?.remote ?? "원격"}에 Push 합니다.` : undefined}
    >
      <div className="row">
        <span className="mono">{store.headBranch}</span>
        <span className="muted">→</span>
        <select className="select" style={{ width: 240 }} value={base} onChange={(e) => setBase(e.target.value)}>
          {!base && <option value="">대상 브랜치</option>}
          {bases.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <input className="input" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="textarea" style={{ height: 220 }} value={body} placeholder="설명 (Markdown)" onChange={(e) => setBody(e.target.value)} />
      <div className="row">
        <Checkbox checked={draft} onChange={setDraft} label="Draft" />
        <span className="spacer" />
        {generating && <Spinner />}
        <Button
          disabled={generating || !base}
          onClick={() => {
            setGenerating(true);
            void store.draftPullRequest(base).then((d) => {
              if (d) {
                setTitle(d[0]);
                setBody(d[1]);
              }
              setGenerating(false);
            });
          }}
        >
          <Sparkles size={13} /> {ai.shortFor("pullRequest")}로 작성
        </Button>
      </div>
    </Frame>
  );
}
