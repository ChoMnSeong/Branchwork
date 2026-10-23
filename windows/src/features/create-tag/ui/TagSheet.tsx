import { useState } from "react";
import type { RepoStore } from "@/entities/repo";
import { t } from "@/shared/i18n";
import { Frame, Row } from "@/shared/ui";

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
