import type { SheetKind } from "../../lib/models";
import type { RepoStore } from "../../lib/repo";
import { RunPipelineSheet } from "./RunPipelineSheet";
import { AddWorktreeSheet } from "./AddWorktreeSheet";
import { NewBranchSheet, StashSheet, TagSheet } from "./BasicSheets";
import { CloneSheet } from "./CloneSheet";
import { CreatePullRequestSheet } from "./CreatePullRequestSheet";
import { InteractiveRebaseSheet } from "./InteractiveRebaseSheet";
import { SplitCommitsSheet } from "./SplitCommitsSheet";
import { StartAgentSheet } from "./StartAgentSheet";

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
