import { Plus, RefreshCw } from "lucide-react";
import { accounts } from "../../lib/accounts";
import { providerInfo, type RepoTarget } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { IconButton, showContextMenu, showMenuBelow, Spinner, type MenuItem } from "../shared/ui";
import { Section } from "./Section";
import { CIStatusIcon } from "./CIPanel";
import { statusInfo } from "../../lib/ci/models";
import { t } from "../../lib/i18n";

export function PullRequestSection({ store, target, openSettings }: { store: RepoStore; target: RepoTarget; openSettings: () => void }) {
  useObserve(accounts);
  useObserve(store.ci);
  const info = providerInfo[target.provider];
  const current = store.hostingAccount;
  const candidates = accounts.candidates(target);
  const st = store.prState;
  return (
    <Section
      id="prs"
      title={st.kind === "loaded" ? `${info.requestsTitle}` : info.requestsTitle}
      count={st.kind === "loaded" ? store.pullRequests.length : undefined}
      actions={
        <>
          {current && (
            <button
              className="link"
              style={{ color: "var(--text-2)", fontWeight: 500 }}
              data-tip={candidates.length > 1 ? t("Choose the account for this repository") : t("Account for this repository")}
              onClick={(e) =>
                showMenuBelow(e.currentTarget, [
                  ...candidates.map((a): MenuItem => ({ label: `@${a.username}`, checked: a.id === current.id, onClick: () => store.useAccount(a) })),
                  "divider",
                  { label: t("Add account…"), onClick: openSettings },
                ])
              }
            >
              @{current.username} ▾
            </button>
          )}
          <IconButton small icon={<RefreshCw size={12} />} tip={t("Refresh list")} onClick={() => void store.loadPullRequests()} />
          <IconButton
            small
            icon={<Plus size={13} />}
            tip={t("New {0} from the current branch", info.requestShort)}
            disabled={!store.headBranch}
            onClick={() => {
              store.sheet = { kind: "createPullRequest" };
              store.changed();
            }}
          />
        </>
      }
    >
      <div style={{ padding: "0 6px" }}>
        {st.kind === "needsAccount" && (
          <div className="col" style={{ gap: 4, alignItems: "flex-start", padding: "2px 0 4px" }}>
            {accounts.accountsFor(target.provider)[0] && (
              <button className="link" onClick={() => void store.tryExistingAccounts()} data-tip={t("If the same server is used under another address, an account you've already connected works there too")}>
                {t("Try with the connected account (@{0})", accounts.accountsFor(target.provider)[0].username)}</button>
            )}
            <button className="link" onClick={openSettings}>
              {target.provider === "gitlab" ? t("Connect a self-hosted GitLab ({0}) account…", target.host) : t("Connect a GitHub account…")}
            </button>
          </div>
        )}
        {st.kind === "failed" && (
          <div className="error-text" style={{ fontSize: 11.5 }}>
            {st.message}
          </div>
        )}
        {st.kind === "loading" && !store.pullRequests.length && <Spinner size={12} />}
        {st.kind === "loaded" && !store.pullRequests.length && <div className="muted">{t("No open {0}", info.requestShort)}</div>}
      </div>
      {store.pullRequests.map((pr) => (
        <div
          key={pr.number}
          className="side-row"
          style={{ alignItems: "flex-start", background: store.selection?.kind === "pullRequest" && store.selection.number === pr.number ? "var(--select)" : undefined }}
          onClick={() => store.select({ kind: "pullRequest", number: pr.number })}
          onContextMenu={(e) =>
            showContextMenu(e, [
              { label: t("Check out branch"), onClick: () => void store.checkoutPullRequest(pr) },
              { label: t("Open in browser"), onClick: () => store.openUrl(pr.url) },
              { label: t("Copy link"), onClick: () => store.copy(pr.url) },
            ])
          }
        >
          <span className="col grow">
            <span className="row">
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                #{pr.number}
              </span>
              <span className="ellipsis">{pr.title}</span>
              {pr.headSHA && store.ci.bySha.get(pr.headSHA) && (
                <span className="ci-badge" data-tip={`CI: ${statusInfo[store.ci.bySha.get(pr.headSHA)!.status].title} · #${store.ci.bySha.get(pr.headSHA)!.number}`}>
                  <CIStatusIcon status={store.ci.bySha.get(pr.headSHA)!.status} size={11} />
                </span>
              )}
            </span>
            <span className="row side-sub">
              {pr.isDraft && <span style={{ color: "var(--orange)", fontWeight: 600 }}>{t("Draft")}</span>}
              <span className="ellipsis">
                {pr.source} → {pr.target}
              </span>
            </span>
          </span>
        </div>
      ))}
    </Section>
  );
}
