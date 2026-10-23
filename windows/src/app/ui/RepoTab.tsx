import { useEffect, useState } from "react";
import { RepoPage } from "@/pages/repo";
import { WelcomePage } from "@/pages/welcome";
import { DialogHost } from "@/widgets/dialog-host";
import type { RepoStore } from "@/entities/repo";
import { t } from "@/shared/i18n";
import { useObserve } from "@/shared/lib";
import { LoadingView } from "@/shared/ui";

/** 탭 하나: 저장소 화면 또는 시작 화면, 그 위의 로딩 화면과 대화상자들 */
export function RepoTab({ store, visible, gitMissing, openSettings }: { store: RepoStore; visible: boolean; gitMissing: boolean; openSettings: () => void }) {
  useObserve(store);
  const showLoading = !store.booted || !!store.loading;
  return (
    <div style={{ position: "absolute", inset: 0, display: visible ? "block" : "none" }}>
      {store.path ? <RepoPage store={store} openSettings={openSettings} /> : store.booted && !store.loading ? <WelcomePage store={store} gitMissing={gitMissing} /> : null}
      <FadingLoading show={showLoading} title={store.loading?.title ?? "Branchwork"} step={store.loading?.step ?? t("Preparing…")} />
      {visible && <DialogHost store={store} />}
    </div>
  );
}

/** 로딩 화면은 내용이 준비되면 부드럽게 사라진다 */
function FadingLoading({ show, title, step }: { show: boolean; title: string; step: string }) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) setMounted(true);
    else {
      const timer = setTimeout(() => setMounted(false), 420);
      return () => clearTimeout(timer);
    }
  }, [show]);
  if (!mounted) return null;
  return <LoadingView title={title} step={step} hidden={!show} />;
}
