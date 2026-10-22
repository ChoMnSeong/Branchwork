import { useEffect, useState } from "react";
import { dirname, displayPath, isWindows, toWslPath, wslDistroOf } from "../../lib/env";
import { ipc } from "../../lib/ipc";
import { useObserve } from "../../lib/observable";
import { toolList, tools, wslCapable, type ToolId } from "../../lib/tools";
import { listDistros } from "../../lib/wsl";
import { settings } from "../../lib/settings";
import { Button, showMenuBelow, Spinner } from "../shared/ui";

export function ToolsSettings() {
  useObserve(tools);
  useObserve(settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  useEffect(() => {
    if (isWindows()) void listDistros().then(setDistros);
  }, []);
  const findInWsl = async (id: ToolId, distro: string) => {
    setError(null);
    setBusy(id);
    try {
      await tools.useWsl(id, distro);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
  const load = async (id: ToolId, title: string) => {
    setError(null);
    const current = tools.path(id);
    const picked = await ipc.pickFile(`${title} 실행 파일 선택`, current ? dirname(current) : undefined);
    if (!picked) return;
    setBusy(id);
    try {
      // \\wsl.localhost\배포판\… 안의 파일이면 WSL 도구로
      const distro = wslDistroOf(picked);
      if (distro && wslCapable.includes(id)) await tools.useWslPath(id, distro, toWslPath(picked));
      else await tools.setCustom(id, picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="hint">
        PC 마다 설치 위치가 달라 자동으로 못 찾으면 <b>불러오기</b>로 실행 파일을 직접 고르세요. 고른 경로는 저장되어 다음에도 그대로 씁니다.
      </span>
      {toolList.map((t) => {
        const st = tools.state[t.id];
        const w = tools.wsl(t.id);
        const canWsl = wslCapable.includes(t.id) && distros.length > 0;
        return (
          <div key={t.id} className="form-section" style={{ gap: 6, padding: 10 }}>
            <div className="row">
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              {t.required && <span className="faint" style={{ fontSize: 11 }}>필수</span>}
              <span className="spacer" />
              {w ? (
                <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
                  WSL · {w.distro}
                </span>
              ) : (
                <>
                  {st.source === "custom" && <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>직접 지정</span>}
                  {st.source === "auto" && <span className="faint" style={{ fontSize: 11 }}>자동으로 찾음</span>}
                  {st.source === "none" && <span className="chip-warn">없음</span>}
                </>
              )}
            </div>
            <span className="hint">{t.detail}</span>
            <div className="row">
              <span className="ellipsis grow mono" style={{ fontSize: 11.5 }}>
                {w ? w.path : st.path ? (st.path.startsWith("wsl:") ? `WSL · ${st.path.slice(4)}` : displayPath(st.path)) : "—"}
              </span>
              {busy === t.id && <Spinner size={12} />}
              {!w && (
                <Button size="small" onClick={() => void load(t.id, t.title)}>
                  불러오기…
                </Button>
              )}
              {canWsl &&
                (w ? (
                  <Button size="small" onClick={() => tools.useWindows(t.id)} tip="WSL 대신 윈도에 설치된 것을 씁니다">
                    윈도 것 쓰기
                  </Button>
                ) : (
                  <Button
                    size="small"
                    tip={`WSL 에서 찾기|WSL(${distros[0]}) 안에 설치한 ${t.command} 를 찾아 씁니다. 배포판이 여럿이면 ▾`}
                    onClick={(e) =>
                      distros.length === 1
                        ? void findInWsl(t.id, distros[0])
                        : showMenuBelow(e.currentTarget, distros.map((d) => ({ label: `${d} 에서 찾기`, onClick: () => void findInWsl(t.id, d) })))
                    }
                  >
                    WSL 에서 찾기
                  </Button>
                ))}
              {t.id === "shell" && distros.length > 0 && (
                <Button
                  size="small"
                  tip="터미널을 WSL 배포판의 셸로 엽니다(저장소 폴더를 리눅스 경로로 바꿔서)"
                  onClick={(e) => showMenuBelow(e.currentTarget, distros.map((d) => ({ label: `WSL · ${d}`, onClick: () => tools.setShellWsl(d) })))}
                >
                  WSL 셸…
                </Button>
              )}
              {st.source === "custom" && (
                <Button size="small" onClick={() => void tools.resetToAuto(t.id)} tip="직접 고른 경로를 지우고 다시 자동으로 찾습니다">
                  자동
                </Button>
              )}
              {st.source === "none" && t.install && (
                <button className="link" onClick={() => void ipc.openUrl(t.install!)}>
                  설치
                </button>
              )}
            </div>
            {(w ? w.version : st.version) && <span className="faint" style={{ fontSize: 11 }}>{w ? w.version : st.version}</span>}
          </div>
        );
      })}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
