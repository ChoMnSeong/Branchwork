import { gitch, type GitchAccount, type GitchBackup, type GitchPreflight, type GitchStatus } from "@/entities/gitch";
import { t } from "@/shared/i18n";
import { RepoTerminal } from "./terminal";

/** gitch(여러 Git 계정 도구): 이 저장소의 계정(잠금)·커밋/push 전 점검·저장소 단위 gitch 명령 (맥 버전 RepoStore+Gitch) */
export abstract class RepoGitch extends RepoTerminal {
  /** gitch 가 관리하는 저장소일 때만(계정을 만들어 두지 않았으면 null — 화면에 gitch 바가 없다) */
  gitchStatus: GitchStatus | null = null;
  gitchPreflight: GitchPreflight | null = null;
  gitchAccounts: GitchAccount[] = [];
  /** 직접 push 를 막은 브랜치(gitch protect) */
  gitchProtected = new Set<string>();
  gitchChecking = false;
  private gitchGen = 0;

  /** gitch 가 보는 이 저장소의 계정과 점검을 다시 읽는다. fetch 면 원격을 받아 받을 커밋까지 본다(몇 초). */
  async refreshGitch(fetch = false) {
    const path = this.path;
    const gen = ++this.gitchGen;
    if (!path || !(await gitch.hasConfig())) {
      if (this.gitchStatus || this.gitchPreflight || this.gitchAccounts.length || this.gitchProtected.size) {
        this.gitchStatus = null;
        this.gitchPreflight = null;
        this.gitchAccounts = [];
        this.gitchProtected = new Set();
        this.emit();
      }
      return;
    }
    this.gitchChecking = true;
    this.emit();
    const [status, preflight, accounts, protectedOut] = await Promise.all([
      gitch.status(path),
      gitch.preflight(path, fetch),
      gitch.accounts(),
      this.g(["config", "--get-all", "gitswitch.protect"], { ok: [0, 1] }).catch(() => null),
    ]);
    if (gen !== this.gitchGen || this.path !== path) return;
    this.gitchChecking = false;
    const managed = status?.inRepo ? status : null;
    this.gitchStatus = managed;
    this.gitchPreflight = managed ? preflight : null;
    this.gitchAccounts = accounts;
    this.gitchProtected = new Set((protectedOut?.stdout ?? "").split(/\r?\n/).filter(Boolean));
    this.emit();
  }

  /**
   * gitch 명령으로 이 저장소를 바꾸고 작성자·그래프·gitch 상태를 다시 읽는다. 실패하면 gitch 가 낸 문구를 보여 준다.
   * gitch 는 브랜치를 옮기기 전에 스스로 백업하므로(gitch rescue) 앱의 되돌리기 기록에는 넣지 않는다.
   */
  async runGitch(args: string[]): Promise<boolean> {
    const path = this.path;
    if (!path || this.busy != null) return false;
    this.busy = t("Running gitch…");
    this.emit();
    let ok = true;
    try {
      await gitch.run(args, path, 900_000);
    } catch (e) {
      this.fail(e);
      ok = false;
    }
    await this.reloadIdentity();
    await this.reload(!ok);
    this.busy = null;
    this.emit();
    await this.refreshGitch();
    return ok;
  }

  /** gitch use · unlock 은 작성자를 바꾸므로 커밋 칸의 내 이름·이메일을 다시 읽는다 */
  private async reloadIdentity() {
    const r = await this.g(["config", "--get-regexp", "^user\\.(name|email)$"], { ok: [0, 1] }).catch(() => null);
    const conf = Object.fromEntries((r?.stdout ?? "").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1).trim()]));
    this.me = conf["user.name"] ? { name: conf["user.name"], email: conf["user.email"] ?? "" } : null;
  }

  /** 이 저장소를 다른 gitch 계정으로(gitch use): 작성자·원격 주소·잠금이 바뀐다 */
  useGitchAccount(id: string) {
    return this.runGitch(["use", id]);
  }

  /** 계정 잠금 풀기(작성자 설정은 그대로) */
  unlockGitch() {
    return this.runGitch(["unlock", "--yes"]);
  }

  /** gitch 검사(작성자·비밀값·push)에서 빼거나 되돌리기 */
  setGitchIgnored(ignored: boolean) {
    return this.runGitch(ignored ? ["ignore", "--yes"] : ["ignore", "--off"]);
  }

  /** 직접 push 를 막는 브랜치로(다른 브랜치에서 PR 로만 합치게) */
  setGitchProtected(branch: string, on: boolean) {
    return this.runGitch(on ? ["protect", branch] : ["protect", "--rm", branch]);
  }

  /** 기본 브랜치 최신을 따라가기(gitch up): push 전이면 rebase, push 한 브랜치면 merge */
  gitchUp() {
    return this.runGitch(["up"]);
  }

  /** 포크를 원본(upstream) 최신으로(gitch sync) */
  gitchSync() {
    return this.runGitch(["sync"]);
  }

  /** push 안 한 커밋 중 작성자가 이 저장소 계정이 아닌 것: 고칠 것이 있으면 확인받고 gitch fix --yes, 없으면 gitch 가 낸 안내 */
  async confirmGitchFix() {
    if (!this.path) return;
    try {
      const r = await gitch.runRaw(["fix"], this.path);
      // 2 = 고칠 커밋이 있어 확인이 필요(목록은 출력에), 0 = 고칠 것 없음
      if (r.status === 2) {
        this.ask({
          title: t("Fix commit authors?"),
          message: r.output.replace(/\n확인이 필요합니다[\s\S]*$/, ""),
          actionTitle: t("Fix"),
          action: () => this.runGitch(["fix", "--yes"]),
        });
      } else if (r.status === 0) {
        this.ask({ title: t("Commit authors are fine"), message: r.output, actionTitle: t("OK"), action: () => {} });
      } else this.showError(r.output);
    } catch (e) {
      this.fail(e);
    }
  }

  gitchBackups(): Promise<GitchBackup[]> {
    return this.path ? gitch.backups(this.path) : Promise.resolve([]);
  }

  /** 백업으로 되돌리기(지금 상태도 먼저 백업) 또는 새 브랜치로 꺼내기. 번호는 실행 직전에 다시 찾는다(그 사이 백업이 늘 수 있어서). */
  async gitchRestore(backup: GitchBackup, toBranch: string | null): Promise<boolean> {
    const index = (await this.gitchBackups()).findIndex((b) => b.ref === backup.ref);
    if (index < 0) {
      this.showError(t("That backup no longer exists."));
      return false;
    }
    const pick = String(index + 1);
    return this.runGitch(toBranch ? ["rescue", pick, "--branch", toBranch] : ["rescue", pick, "--restore", "--yes"]);
  }

  /** 아래 터미널 탭에서 gitch 명령(doctor 처럼 길게 보여 주는 것) */
  async runGitchInTerminal(args: string[]) {
    const c = await gitch.terminalCommand(args);
    if (!c) {
      this.showError(t("Couldn't find gitch inside Gitrochi."));
      return;
    }
    this.newTerminal(this.path ?? undefined, { program: c.program, args: c.args, title: `gitch ${args.join(" ")}` });
  }
}
