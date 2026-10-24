import { useState } from "react";
import { type GraphRelation, graphDiffRelations } from "@/entities/gitch";
import type { RepoStore } from "@/entities/repo";
import { t } from "@/shared/i18n";
import { Frame, Row } from "@/shared/ui";

/** 「이 브랜치에서 바뀐 의존」의 기준 고르기(gitch graph diff). 고른 브랜치 · 태그와 이 브랜치가 갈라진 곳과 비교한다 (맥 버전 GraphDiffSheet) */
export function GraphDiffSheet({ store, close }: { store: RepoStore; close: () => void }) {
  const [relation, setRelation] = useState<GraphRelation>("files");
  /** 빈 글자면 gitch 가 고른다(기본 브랜치와 갈라진 곳) */
  const [base, setBase] = useState("");
  const local = store.localBranches.filter((b) => !b.isCurrent);
  return (
    <Frame
      title={t("Compare dependencies")}
      confirm={t("Compare")}
      width={560}
      canConfirm
      close={close}
      onConfirm={() => void store.openGraphDiff(relation, base || null)}
    >
      <Row label={t("Structure graph")}>
        <select className="select grow" value={relation} onChange={(e) => setRelation(e.target.value as GraphRelation)}>
          {graphDiffRelations().map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Compare with")}>
        <select className="select grow" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="">{t("Default branch (where this branch split off)")}</option>
          {local.length > 0 && (
            <optgroup label={t("Local branches")}>
              {local.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {store.remoteBranches.length > 0 && (
            <optgroup label={t("Remotes")}>
              {store.remoteBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {store.tags.length > 0 && (
            <optgroup label={t("Tags")}>
              {store.tags.map((tag) => (
                <option key={tag.name} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Row>
      <span className="hint">{t("Gitrochi compares with where this branch split off from the branch or tag you pick, so only this branch's changes show. Uncommitted changes to tracked files are included.")}</span>
    </Frame>
  );
}
