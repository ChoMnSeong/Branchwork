import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ai } from "../../lib/ai";
import { providerInfo } from "../../lib/models";
import type { RepoStore } from "../../lib/repo";
import { Button, Checkbox, Spinner } from "../shared/ui";
import { Frame } from "./Frame";
import { t } from "../../lib/i18n";

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
      title={t("New {0}", providerInfo[provider].requestName)}
      confirm={t("Create")}
      width={640}
      canConfirm={!!title.trim() && !!base}
      close={close}
      onConfirm={() => void store.createPullRequest(title.trim(), body, base, draft)}
      leftFooter={store.status.upstream == null || store.status.ahead > 0 ? t("Pushes the current branch to {0} before creating.", store.target?.remote ?? t("Remotes")) : undefined}
    >
      <div className="row">
        <span className="mono">{store.headBranch}</span>
        <span className="muted">→</span>
        <select className="select" style={{ width: 240 }} value={base} onChange={(e) => setBase(e.target.value)}>
          {!base && <option value="">{t("Target branch")}</option>}
          {bases.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <input className="input" placeholder={t("Title")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="textarea" style={{ height: 220 }} value={body} placeholder={t("Description (Markdown)")} onChange={(e) => setBody(e.target.value)} />
      <div className="row">
        <Checkbox checked={draft} onChange={setDraft} label={t("Draft")} />
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
          <Sparkles size={13} /> {" "}{t("Write with {0}", ai.shortFor("pullRequest"))}</Button>
      </div>
    </Frame>
  );
}
