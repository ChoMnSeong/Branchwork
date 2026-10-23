import { useState } from "react";
import type { RepoStore } from "@/entities/repo";
import { t } from "@/shared/i18n";
import { Checkbox, Frame, Row } from "@/shared/ui";

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
