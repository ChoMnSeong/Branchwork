import type { AgentHost } from "./agents";
import { CIStore } from "./ci/store";
import { RepoTerminal } from "./repo/terminal";

export { branchPayload, commitPayload } from "./repo/drop";
export type { SplitGroup } from "./split";

/**
 * 열린 저장소 하나(=탭 하나)의 상태와 모든 git 작업. 화면은 이 객체만 바라본다. (맥 버전 RepoStore)
 * 기능별로 repo/ 아래 파일에 나눠 두고 차례로 이어 붙인다:
 * core → selection → search → actions → drop → worktrees → hosting → ai → terminal
 */
export class RepoStore extends RepoTerminal implements AgentHost {
  /** CI/CD 패널(파이프라인·Actions) */
  readonly ci: CIStore = new CIStore(this);
}
