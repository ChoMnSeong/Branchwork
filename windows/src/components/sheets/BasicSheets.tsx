import { useState } from "react";
import { validBranchName } from "../../lib/format";
import type { RepoStore } from "../../lib/repo";
import { Checkbox } from "../shared/ui";
import { Frame, Row } from "./Frame";
import { t } from "../../lib/i18n";

export function NewBranchSheet({ store, close, start, label }: { store: RepoStore; close: () => void; start: string; label: string }) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  return (
    <Frame title={t("New branch")} confirm={t("Create")} canConfirm={validBranchName(name)} close={close} onConfirm={() => void store.createBranch(name.trim(), start, checkout)}>
      <Row label={t("Name")}>
        <input className="input" autoFocus value={name} placeholder={t("feature/new-feature")} onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label={t("Start point")}>
        <span className="mono">{label}</span>
      </Row>
      <Row label="">
        <Checkbox checked={checkout} onChange={setCheckout} label={t("Check out after creating")} />
      </Row>
    </Frame>
  );
}

export function TagSheet({ store, close, sha }: { store: RepoStore; close: () => void; sha: string }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Frame title={t("Create tag")} confirm={t("Create")} canConfirm={!!name.trim() && !/\s/.test(name.trim())} close={close} onConfirm={() => void store.createTag(name.trim(), message, sha)}>
      <Row label={t("Name")}>
        <input className="input" autoFocus value={name} placeholder="v1.0.0" onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label={t("Message")}>
        <input className="input" value={message} placeholder={t("Leave empty for a lightweight tag")} onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label={t("Commit")}>
        <span className="mono">{sha.slice(0, 10)}</span>
      </Row>
    </Frame>
  );
}

export function StashSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  return (
    <Frame title={t("Stash changes")} confirm={t("Stash")} canConfirm close={close} onConfirm={() => void store.stash(message, untracked)}>
      <Row label={t("Message")}>
        <input className="input" autoFocus value={message} placeholder={t("Optional")} onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label="">
        <Checkbox checked={untracked} onChange={setUntracked} label={t("Include untracked new files")} />
      </Row>
    </Frame>
  );
}
