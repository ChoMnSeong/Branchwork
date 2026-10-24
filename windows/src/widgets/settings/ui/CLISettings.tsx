import { useCallback, useEffect, useState } from "react";
import { gitch, type GitchAccount } from "@/entities/gitch";
import { displayPath, env, slash } from "@/shared/config";
import { t } from "@/shared/i18n";
import { Button, Spinner } from "@/shared/ui";

interface Info {
  bundledVersion: string | null;
  installed: { name: string; path: string; version: string | null } | null;
  installedIsBundled: boolean;
  hasConfig: boolean;
  bash: string | null;
  accounts: GitchAccount[];
}

/** 홈 폴더를 ~ 로(설치 위치를 짧게) */
function tilde(p: string) {
  const home = slash(env.home).toLowerCase();
  const s = slash(p);
  return home && s.toLowerCase().startsWith(home) ? "~" + s.slice(home.length) : displayPath(p);
}

/**
 * 설정 > CLI 의 gitch(예전 이름 gitsw): 앱에 든 gitch 를 셸 명령으로 설치한다. (맥 버전 GitchSettings)
 * 계정 더하기·SSH 키·진단은 묻는 것이 있어 새 콘솔 창(Git Bash)에서.
 */
export function CLISettings() {
  const [info, setInfo] = useState<Info | null>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bundled = gitch.bundled;
    const [bundledVersion, installed, installedIsBundled, hasConfig, bash, accounts] = await Promise.all([
      bundled ? gitch.version(bundled) : Promise.resolve(null),
      gitch.installed(),
      gitch.installedIsBundled(),
      gitch.hasConfig(),
      gitch.bash(),
      gitch.accounts(),
    ]);
    setInfo({ bundledVersion, installed: installed && { ...installed, version: await gitch.version(installed.path) }, installedIsBundled, hasConfig, bash, accounts });
  }, []);
  // 콘솔 창에서 계정을 더하고 돌아오면 다시 읽는다
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const install = async () => {
    setConfirmInstall(false);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // 마지막 몇 줄(설치 완료 안내)만 보여 준다
      setResult((await gitch.install()).split("\n").slice(-6).join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    void load();
  };

  if (!info) {
    return (
      <div className="row" style={{ justifyContent: "center", padding: 40 }}>
        <Spinner />
      </div>
    );
  }
  const status = !info.installed ? (
    <span className="chip-warn">{t("Not installed")}</span>
  ) : info.installedIsBundled ? (
    <span className="chip-warn" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
      {t("Installed")}
    </span>
  ) : (
    <span className="faint" style={{ fontSize: 11 }}>{t("Installed from another copy")}</span>
  );
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="form-section" style={{ gap: 8, padding: 12 }}>
        <div className="row">
          <span style={{ fontWeight: 600 }}>gitch</span>
          <span className="spacer" />
          {status}
        </div>
        <span className="hint">
          {t("gitch keeps several Git accounts apart: it locks each repository to an account, picks the account by folder or organization, and blocks wrong authors, secrets and force pushes in git hooks, in the terminal, for AI agents and in Gitrochi.")}
        </span>
        <Field label={t("Version in Gitrochi")}>{info.bundledVersion ?? "—"}</Field>
        <Field label={t("Shell command")}>
          {info.installed ? `${info.installed.name} → ${tilde(info.installed.path)}${info.installed.version ? ` (${info.installed.version})` : ""}` : "—"}
        </Field>
        <Field label="Git Bash">{info.bash ? displayPath(info.bash) : "—"}</Field>
        <Field label={t("Accounts")}>{info.accounts.length ? String(info.accounts.length) : t("None yet")}</Field>
        {info.accounts.map((a) => (
          <div key={a.id} className="row" style={{ alignItems: "flex-start", paddingLeft: 4 }}>
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{a.id}</span>
                <span className="muted ellipsis">{a.email}</span>
              </div>
              <span className="faint" style={{ fontSize: 11.5 }}>
                {[a.hosts, a.rules ?? ""].filter(Boolean).join(" · ")}
              </span>
            </div>
            {a.sshKey === false && (
              <Button size="small" onClick={() => void run(() => gitch.openInConsole(["setup", a.id]))}>
                {t("Set up SSH key in a terminal…")}
              </Button>
            )}
          </div>
        ))}
        {!info.bash && (
          <span className="error-text">
            {t("gitch needs Git for Windows (Git Bash). Install it from https://git-scm.com/download/win.")}
          </span>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Button disabled={!info.bash} onClick={() => void run(() => gitch.openInConsole(["add"]))}>
            {t("Add an account in a terminal…")}
          </Button>
          <Button kind="primary" disabled={!info.hasConfig || busy || !info.bundledVersion || !info.bash} onClick={() => setConfirmInstall(true)}>
            {info.installedIsBundled ? t("Reinstall…") : t("Install…")}
          </Button>
          <Button disabled={!info.bash || (!info.installed && !info.bundledVersion)} onClick={() => void run(() => gitch.openInConsole(["doctor"]))}>
            {t("Run doctor in a terminal")}
          </Button>
          <span className="spacer" />
          {busy && <Spinner size={13} />}
        </div>
        {confirmInstall && (
          <div className="form-section" style={{ gap: 8, padding: 10 }}>
            <span style={{ fontWeight: 600 }}>{t("Install gitch?")}</span>
            <span className="hint" style={{ whiteSpace: "pre-wrap" }}>
              {t(
                "This changes files outside Gitrochi, backing them up first:\n• ~/bin/gitch and the old name ~/bin/gitsw: link to the gitch inside Gitrochi (and gitch.cmd for PowerShell and cmd; ~/bin is added to your user PATH)\n• ~/.bashrc: adds a gitch block for Git Bash\n• ~/.gitconfig: global hooks that check authors, secrets, big files and force pushes, and rules that pick the account\n• ~/.claude and ~/.codex: rules, skills and a hook for AI agents\nRemove it later with gitch uninstall.",
              )}
            </span>
            <div className="row">
              <span className="spacer" />
              <Button onClick={() => setConfirmInstall(false)}>{t("Cancel")}</Button>
              <Button kind="primary" onClick={() => void install()}>
                {t("Install")}
              </Button>
            </div>
          </div>
        )}
        {result && (
          <pre className="mono selectable muted" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", margin: 0 }}>
            {result}
          </pre>
        )}
        {error && <span className="error-text selectable" style={{ whiteSpace: "pre-wrap" }}>{error}</span>}
        <span className="hint">
          {info.hasConfig
            ? t("Open a new terminal window to start using gitch.")
            : t("Add an account first: gitch add asks for the account's name, email and server and makes an SSH key for it. Then install.")}
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="muted" style={{ width: 130, flex: "none" }}>
        {label}
      </span>
      <span className="mono ellipsis selectable grow" style={{ fontSize: 11.5 }}>
        {children}
      </span>
    </div>
  );
}
