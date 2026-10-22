import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useObserve } from "../../lib/observable";
import { planChanged, planProblem, rebaseActions, type RebaseItem, type RebasePlan } from "../../lib/rebase";
import type { RepoStore } from "../../lib/repo";
import { Button, IconButton, Modal } from "../shared/ui";

/** 커밋 정리(인터랙티브 리베이스): 커밋마다 그대로·메시지 고치기·아래 커밋에 합치기·빼기를 고르고 순서를 바꾼다 (맥 버전 InteractiveRebaseSheet) */
export function InteractiveRebaseSheet({ store, close }: { store: RepoStore; close: () => void }) {
  useObserve(store);
  const [plan, setPlan] = useState<RebasePlan | null>(() => store.rebasePlan);
  if (!plan) return null;
  const problem = planProblem(plan);
  const update = (i: number, f: (it: RebaseItem) => RebaseItem) => setPlan({ ...plan, items: plan.items.map((it, n) => (n === i ? f(it) : it)) });
  const shift = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= plan.items.length) return;
    const items = [...plan.items];
    [items[i], items[j]] = [items[j], items[i]];
    setPlan({ ...plan, items });
  };

  return (
    <Modal
      title="커밋 정리"
      width={720}
      onClose={close}
      footer={
        <>
          <span className="hint grow" style={problem ? { color: "var(--red)" } : undefined}>
            {problem ?? "시작하기 전 상태로 언제든 되돌릴 수 있습니다(되돌리기 Ctrl+Z)."}
          </span>
          <Button onClick={close}>취소</Button>
          <Button
            kind="primary"
            disabled={!!problem || !planChanged(plan) || store.busy != null}
            onClick={() => {
              close();
              void store.runInteractiveRebase(plan);
            }}
          >
            정리 시작
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 4, marginBottom: 10 }}>
        <span className="muted">
          '{store.headBranch}'의 커밋 {plan.items.length}개 — 위가 최신입니다. 합치기는 바로 아래(이전) 커밋에 합칩니다.
        </span>
        {plan.pushed && (
          <span style={{ color: "var(--orange)", fontSize: 12 }}>
            <TriangleAlert size={12} style={{ verticalAlign: -2 }} /> 이미 원격에 올린 커밋이 들어 있습니다. 정리한 뒤에는 강제 푸시가 필요합니다.
          </span>
        )}
      </div>
      <div className="col rebase-list">
        {plan.items.map((it, i) => (
          <div key={it.sha} className={`rebase-item ${it.action}`}>
            <div className="row" style={{ gap: 8 }}>
              <select
                className="select"
                style={{ width: 210, height: 26, padding: "0 6px" }}
                value={it.action}
                aria-label="이 커밋을 어떻게 할지"
                onChange={(e) => update(i, (x) => ({ ...x, action: e.target.value as RebaseItem["action"] }))}
              >
                {rebaseActions.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.title}
                  </option>
                ))}
              </select>
              <span className="mono muted">{it.sha.slice(0, 7)}</span>
              <span className="ellipsis grow rebase-subject" data-tip={it.message}>
                {it.subject}
              </span>
              <span className="muted ellipsis" style={{ fontSize: 11.5, maxWidth: 120 }}>
                {it.author}
              </span>
              <IconButton icon={<ArrowUp size={14} />} aria-label="위로" tip="위로(나중으로)" disabled={i === 0} onClick={() => shift(i, -1)} />
              <IconButton icon={<ArrowDown size={14} />} aria-label="아래로" tip="아래로(먼저로)" disabled={i === plan.items.length - 1} onClick={() => shift(i, 1)} />
            </div>
            {it.action === "reword" && (
              <textarea className="input" style={{ height: 64, marginTop: 6 }} value={it.newMessage} onChange={(e) => update(i, (x) => ({ ...x, newMessage: e.target.value }))} />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
