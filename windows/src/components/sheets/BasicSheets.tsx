import { useState } from "react";
import { validBranchName } from "../../lib/format";
import type { RepoStore } from "../../lib/repo";
import { Checkbox } from "../shared/ui";
import { Frame, Row } from "./Frame";

export function NewBranchSheet({ store, close, start, label }: { store: RepoStore; close: () => void; start: string; label: string }) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  return (
    <Frame title="새 브랜치" confirm="만들기" canConfirm={validBranchName(name)} close={close} onConfirm={() => void store.createBranch(name.trim(), start, checkout)}>
      <Row label="이름">
        <input className="input" autoFocus value={name} placeholder="feature/새-기능" onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label="시작 위치">
        <span className="mono">{label}</span>
      </Row>
      <Row label="">
        <Checkbox checked={checkout} onChange={setCheckout} label="만든 뒤 체크아웃" />
      </Row>
    </Frame>
  );
}

export function TagSheet({ store, close, sha }: { store: RepoStore; close: () => void; sha: string }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Frame title="태그 만들기" confirm="만들기" canConfirm={!!name.trim() && !/\s/.test(name.trim())} close={close} onConfirm={() => void store.createTag(name.trim(), message, sha)}>
      <Row label="이름">
        <input className="input" autoFocus value={name} placeholder="v1.0.0" onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Row>
      <Row label="메시지">
        <input className="input" value={message} placeholder="비우면 가벼운 태그" onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label="커밋">
        <span className="mono">{sha.slice(0, 10)}</span>
      </Row>
    </Frame>
  );
}

export function StashSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  return (
    <Frame title="변경 사항 Stash" confirm="Stash" canConfirm close={close} onConfirm={() => void store.stash(message, untracked)}>
      <Row label="메시지">
        <input className="input" autoFocus value={message} placeholder="선택 사항" onChange={(e) => setMessage(e.target.value)} />
      </Row>
      <Row label="">
        <Checkbox checked={untracked} onChange={setUntracked} label="추적하지 않는 새 파일도 포함" />
      </Row>
    </Frame>
  );
}
