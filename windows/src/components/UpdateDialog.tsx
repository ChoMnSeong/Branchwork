import { Download } from "lucide-react";
import { env } from "../lib/env";
import { useObserve } from "../lib/observable";
import { updater } from "../lib/updater";
import { Button, Modal, Spinner } from "./ui";

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** 새 버전 안내 → 받기 → 설치 → 다시 시작 */
export function UpdateDialog() {
  useObserve(updater);
  if (!updater.prompt) return null;
  const u = updater.info;
  const busy = updater.state === "downloading" || updater.state === "installing";
  const close = () => !busy && updater.dismiss();

  if (updater.state === "error" && !u) {
    return (
      <Modal title="업데이트를 확인하지 못했습니다" onClose={close} footer={<Button onClick={close}>확인</Button>}>
        <div className="modal-message selectable">{updater.error}</div>
      </Modal>
    );
  }
  if (!u) {
    return (
      <Modal title="최신 버전입니다" onClose={close} footer={<Button kind="primary" onClick={close}>확인</Button>}>
        <div className="modal-message">Branchwork {env.version} 이(가) 가장 새 버전입니다.</div>
      </Modal>
    );
  }
  const pct = updater.total ? Math.min(100, (updater.downloaded / updater.total) * 100) : null;
  return (
    <Modal
      title={`새 버전 ${u.version} 이(가) 나왔습니다`}
      width={540}
      onClose={close}
      footer={
        busy ? (
          <span className="row muted">
            <Spinner size={13} /> {updater.state === "installing" ? "설치하는 중… 끝나면 다시 시작합니다" : "받는 중…"}
          </span>
        ) : (
          <>
            <Button onClick={() => updater.skip()}>이 버전 건너뛰기</Button>
            <Button onClick={close}>나중에</Button>
            <Button kind="primary" onClick={() => void updater.install()}>
              <Download size={14} /> 지금 업데이트
            </Button>
          </>
        )
      }
    >
      <div className="muted">
        지금 버전 {u.current} → {u.version}
        {u.date ? ` · ${u.date.slice(0, 10)}` : ""}
      </div>
      {u.notes && (
        <div className="markdown selectable" style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 12.5 }}>
          {u.notes}
        </div>
      )}
      {busy && (
        <div className="col" style={{ gap: 4 }}>
          <div style={{ height: 6, borderRadius: 99, background: "var(--hover)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct === null ? "30%" : `${pct}%`, background: "var(--accent)", transition: "width .2s" }} />
          </div>
          <span className="hint">
            {mb(updater.downloaded)}MB{updater.total ? ` / ${mb(updater.total)}MB` : ""}
          </span>
        </div>
      )}
      {updater.state === "error" && <span className="error-text">{updater.error}</span>}
      <span className="hint">설치 파일은 Branchwork 서명이 맞을 때만 설치됩니다. 설치하는 동안 창이 잠깐 닫혔다가 다시 열립니다.</span>
    </Modal>
  );
}
