import { ipc } from "../../lib/ipc";
import { useObserve } from "../../lib/observable";
import { updater } from "../../lib/updater";
import { settings } from "../../lib/settings";
import { env } from "../../lib/env";
import icon from "../../assets/icon.png";
import { Button, Checkbox, Spinner } from "../shared/ui";

/** 버전과 자동 업데이트 */
export function AboutSettings() {
  useObserve(updater);
  useObserve(settings);
  const status =
    updater.state === "checking"
      ? "확인하는 중…"
      : updater.state === "available"
        ? `새 버전 ${updater.info?.version} 이(가) 있습니다`
        : updater.state === "none"
          ? "최신 버전입니다"
          : updater.state === "error"
            ? `확인 실패: ${updater.error}`
            : "";
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="form-section">
        <div className="row">
          <img src={icon} width={48} height={48} alt="" />
          <div className="col grow">
            <span style={{ fontSize: 16, fontWeight: 600 }}>Branchwork {env.version}</span>
            <span className="hint">Git 저장소를 그래프로 보고 다루는 앱 · MIT</span>
          </div>
          <button className="link" onClick={() => void ipc.openUrl("https://github.com/ChoMnSeong/Branchwork/releases")}>
            릴리스 노트
          </button>
        </div>
      </div>
      <div className="form-section">
        <span className="form-section-title">자동 업데이트</span>
        <Checkbox checked={updater.autoCheck} onChange={(v) => updater.setAutoCheck(v)} label="켤 때와 하루에 한 번 새 버전 확인" />
        <div className="row">
          <Button disabled={updater.state === "checking" || updater.state === "downloading"} onClick={() => void updater.check(true)}>
            지금 확인
          </Button>
          {updater.state === "checking" && <Spinner />}
          <span className="hint grow">{status}</span>
        </div>
        <span className="hint">새 버전이 있으면 알려 주고, 누르면 받아서 설치한 뒤 다시 시작합니다. 설치 파일은 Branchwork 서명이 맞을 때만 설치됩니다.</span>
      </div>
    </div>
  );
}
