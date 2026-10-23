import { AddWorktreeSheet } from "@/features/add-worktree";
import { CloneSheet } from "@/features/clone-repo";
import { NewBranchSheet } from "@/features/create-branch";
import { CreatePullRequestSheet } from "@/features/create-pull-request";
import { TagSheet } from "@/features/create-tag";
import { InteractiveRebaseSheet } from "@/features/interactive-rebase";
import { RunPipelineSheet } from "@/features/run-pipeline";
import { SplitCommitsSheet } from "@/features/split-commits";
import { StartAgentSheet } from "@/features/start-agent";
import { StashSheet } from "@/features/stash-changes";
import type { SheetKind } from "@/entities/git";
import type { RepoStore } from "@/entities/repo";

export function SheetHost({ store }: { store: RepoStore }) {
  const s = store.sheet;
  if (!s) return null;
  const close = () => {
    store.sheet = null;
    store.changed();
  };
  return <SheetSwitch store={store} sheet={s} close={close} />;
}

function SheetSwitch({ store, sheet, close }: { store: RepoStore; sheet: SheetKind; close: () => void }) {
  switch (sheet.kind) {
    case "clone":
      return <CloneSheet store={store} close={close} />;
    case "stash":
      return <StashSheet store={store} close={close} />;
    case "newBranch":
      return <NewBranchSheet store={store} close={close} start={sheet.start} label={sheet.label} />;
    case "tag":
      return <TagSheet store={store} close={close} sha={sheet.sha} />;
    case "createPullRequest":
      return <CreatePullRequestSheet store={store} close={close} />;
    case "startAgent":
      return <StartAgentSheet store={store} close={close} presetPath={sheet.path} />;
    case "addWorktree":
      return <AddWorktreeSheet store={store} close={close} presetBranch={sheet.branch} start={sheet.start} />;
    case "splitCommits":
      return <SplitCommitsSheet store={store} close={close} />;
    case "runPipeline":
      return <RunPipelineSheet store={store} close={close} />;
    case "interactiveRebase":
      return <InteractiveRebaseSheet store={store} close={close} />;
  }
}
