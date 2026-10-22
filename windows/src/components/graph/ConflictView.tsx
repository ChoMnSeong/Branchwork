import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { choiceLines, choiceTitle, type ConflictBlock, type ConflictDocument } from "../../lib/conflict";
import type { FileChange } from "../../lib/models";
import type { RepoStore } from "../../lib/repo";
import { Button, showMenuBelow, Spinner } from "../shared/ui";

/** 충돌 해결: 충돌 블록마다 내 것 · 상대 것 · 둘 다 · 직접 고치기를 고르고, 다 고르면 저장하고 해결됨으로 표시 (맥 버전 ConflictView) */
export function ConflictView({ store, change }: { store: RepoStore; change: FileChange }) {
  useEffect(() => {
    void store.loadConflict(change.path);
  }, [store, change.path]);
  const doc = store.conflictPath === change.path ? store.conflictDoc : null;
  if (!doc)
    return (
      <div className="empty">
        <Spinner size={20} />
      </div>
    );
  return doc.blocks.length ? <Resolver store={store} change={change} doc={doc} /> : <NoMarkers store={store} change={change} />;
}

/** 충돌 표시가 없는 충돌(한쪽이 지웠거나 바이너리) */
function NoMarkers({ store, change }: { store: RepoStore; change: FileChange }) {
  const sides = store.conflictSides;
  return (
    <div className="empty">
      <TriangleAlert size={30} />
      <div className="big">충돌 표시가 없는 충돌</div>
      <div>한쪽에서 파일을 지웠거나 바이너리 파일입니다. 파일을 남길지 지울지 고르세요.</div>
      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <Button onClick={() => void store.resolveDeleted(change, false)}>이 파일 지우기</Button>
        <Button kind="primary" onClick={() => void store.resolveDeleted(change, true)}>
          이 파일 남기기
        </Button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button size="small" onClick={() => void store.resolveWholeFile(change, true)}>
          내 것으로({sides.ours})
        </Button>
        <Button size="small" onClick={() => void store.resolveWholeFile(change, false)}>
          상대 것으로({sides.theirs})
        </Button>
      </div>
    </div>
  );
}

function Resolver({ store, change, doc }: { store: RepoStore; change: FileChange; doc: ConflictDocument }) {
  const sides = store.conflictSides;
  const done = doc.blocks.filter((b) => store.conflictChoices.has(b.id)).length;
  const all = done === doc.blocks.length;
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="conflict-bar">
        <TriangleAlert size={15} style={{ color: "var(--orange)" }} />
        <span style={{ fontWeight: 600 }}>
          충돌 {doc.blocks.length}곳 — {done}곳 골랐습니다
        </span>
        <span className="spacer" />
        <Button
          size="small"
          tip="블록마다 고르지 않고 파일 전체를 한쪽으로 바로 해결합니다"
          onClick={(e) =>
            showMenuBelow(e.currentTarget, [
              { label: `모두 내 것(${sides.ours})`, onClick: () => void store.resolveWholeFile(change, true) },
              { label: `모두 상대 것(${sides.theirs})`, onClick: () => void store.resolveWholeFile(change, false) },
            ])
          }
        >
          파일 전체를 <ChevronDown size={12} />
        </Button>
        <Button
          size="small"
          kind="primary"
          disabled={!all || !!store.busy}
          tip={all ? "고른 대로 파일을 저장하고 스테이지합니다" : "모든 충돌 블록을 골라야 저장할 수 있습니다"}
          onClick={() => void store.saveConflictResolution(change)}
        >
          저장하고 해결됨으로 표시
        </Button>
      </div>
      <div className="conflict-scroll">
        {doc.segments.map((s, i) =>
          s.kind === "text" ? <TextSegment key={i} lines={s.lines} /> : <BlockCard key={i} store={store} block={doc.blocks[s.block]} sides={sides} />,
        )}
      </div>
    </div>
  );
}

/** 충돌 없는 부분: 길면 앞뒤 3줄만 */
function TextSegment({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const short = lines.length > 8 && !expanded;
  return (
    <div className="conflict-text">
      {(short ? lines.slice(0, 3) : lines).map((l, i) => (
        <div key={i}>{l || " "}</div>
      ))}
      {short && (
        <>
          <button type="button" className="link" style={{ fontFamily: "var(--font)", fontSize: 11.5, padding: "2px 0" }} onClick={() => setExpanded(true)}>
            … {lines.length - 6}줄 더 보기
          </button>
          {lines.slice(-3).map((l, i) => (
            <div key={`t${i}`}>{l || " "}</div>
          ))}
        </>
      )}
    </div>
  );
}

/** 충돌 블록 하나: 왼쪽 내 것, 오른쪽 상대 것, 아래 고르기 */
function BlockCard({ store, block, sides }: { store: RepoStore; block: ConflictBlock; sides: { ours: string; theirs: string } }) {
  const choice = store.conflictChoices.get(block.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className={`conflict-block ${choice ? "done" : ""}`}>
      {choice && !editing ? (
        <>
          <div className="row" style={{ gap: 6 }}>
            <Check size={14} style={{ color: "var(--green)" }} />
            <span style={{ fontWeight: 600, color: "var(--green)" }}>고름: {choiceTitle(choice)}</span>
            <span className="spacer" />
            <Button size="small" onClick={() => store.chooseConflict(block.id, null)}>
              다시 고르기
            </Button>
          </div>
          <Code lines={choiceLines(block, choice)} tone="chosen" />
        </>
      ) : editing ? (
        <>
          <span style={{ fontWeight: 600 }}>직접 고치기</span>
          <textarea className="conflict-edit" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button size="small" onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button
              size="small"
              kind="primary"
              onClick={() => {
                store.chooseConflict(block.id, { kind: "custom", text });
                setEditing(false);
              }}
            >
              이렇게 쓰기
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="conflict-sides">
            <Side title={`내 것 · ${sides.ours}`} label={block.oursLabel} lines={block.ours} tone="ours" />
            <Side title={`상대 것 · ${sides.theirs}`} label={block.theirsLabel} lines={block.theirs} tone="theirs" />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="small" onClick={() => store.chooseConflict(block.id, { kind: "ours" })}>
              내 것
            </Button>
            <Button size="small" onClick={() => store.chooseConflict(block.id, { kind: "theirs" })}>
              상대 것
            </Button>
            <Button
              size="small"
              onClick={(e) =>
                showMenuBelow(e.currentTarget, [
                  { label: "내 것 먼저", onClick: () => store.chooseConflict(block.id, { kind: "oursThenTheirs" }) },
                  { label: "상대 것 먼저", onClick: () => store.chooseConflict(block.id, { kind: "theirsThenOurs" }) },
                ])
              }
            >
              둘 다 <ChevronDown size={12} />
            </Button>
            <Button
              size="small"
              onClick={() => {
                setText([...block.ours, ...block.theirs].join("\n"));
                setEditing(true);
              }}
            >
              직접 고치기…
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Side({ title, label, lines, tone }: { title: string; label: string; lines: string[]; tone: "ours" | "theirs" }) {
  return (
    <div className={`conflict-side ${tone}`}>
      <span className="conflict-side-title" data-tip={label ? `${title}|${label}` : title}>
        {title}
      </span>
      <Code lines={lines} tone={tone} />
    </div>
  );
}

function Code({ lines, tone }: { lines: string[]; tone: "ours" | "theirs" | "chosen" }) {
  return (
    <div className={`conflict-code ${tone}`}>
      {lines.length ? lines.map((l, i) => <div key={i}>{l || " "}</div>) : <div className="muted">(비어 있음)</div>}
    </div>
  );
}
