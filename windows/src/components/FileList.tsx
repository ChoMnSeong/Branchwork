import { ChevronDown, ChevronRight, Folder, FolderOpen, List, ListTree } from "lucide-react";
import { useState, type ReactNode } from "react";
import { changeId, fileDir, fileName, type FileChange, type LineStat } from "../lib/models";
import { useObserve } from "../lib/observable";
import { settings } from "../lib/settings";
import { IconButton, LineStatText, Segmented, showContextMenu, StatusBadge, type MenuItem } from "./ui";

/** 변경 파일 보기 방식(목록/트리) — 작업 영역과 커밋 상세가 함께 쓴다 */
export function useFileViewMode(): "list" | "tree" {
  useObserve(settings);
  return settings.get<"list" | "tree">("fileViewMode", "list");
}

export function FileViewToggle() {
  const mode = useFileViewMode();
  return (
    <Segmented
      value={mode}
      onChange={(v) => settings.set("fileViewMode", v)}
      options={[
        { value: "list", label: <List size={14} />, tip: "목록으로 보기" },
        { value: "tree", label: <ListTree size={14} />, tip: "폴더 트리로 보기" },
      ]}
    />
  );
}

type TreeRow = { id: string; depth: number } & ({ kind: "folder"; path: string; name: string; files: FileChange[] } | { kind: "file"; change: FileChange });

interface Node {
  dirs: Map<string, Node>;
  files: FileChange[];
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** 경로를 폴더 트리로 펼친 행. 파일 없이 폴더 하나만 든 폴더는 한 줄로 합친다(src/main/java). */
export function treeRows(changes: FileChange[], collapsed: Set<string>): TreeRow[] {
  const root: Node = { dirs: new Map(), files: [] };
  for (const c of changes) {
    let node = root;
    for (const dir of c.path.split("/").slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir)!;
    }
    node.files.push(c);
  }
  const allFiles = (n: Node): FileChange[] => [...n.files, ...[...n.dirs.values()].flatMap(allFiles)];
  const out: TreeRow[] = [];
  const emit = (n: Node, prefix: string, depth: number) => {
    for (const name of [...n.dirs.keys()].sort(natural)) {
      let child = n.dirs.get(name)!;
      let label = name;
      let path = prefix ? prefix + "/" + name : name;
      while (!child.files.length && child.dirs.size === 1) {
        const [k, v] = [...child.dirs.entries()][0];
        label += "/" + k;
        path += "/" + k;
        child = v;
      }
      out.push({ id: "d:" + path, depth, kind: "folder", path, name: label, files: allFiles(child) });
      if (!collapsed.has(path)) emit(child, path, depth + 1);
    }
    for (const f of [...n.files].sort((a, b) => natural(fileName(a.path), fileName(b.path)))) out.push({ id: "f:" + changeId(f), depth, kind: "file", change: f });
  };
  emit(root, "", 0);
  return out;
}

/** 변경 파일 목록. 트리 모드에서는 폴더를 접고 펼 수 있고, 폴더 단위로 스테이지·언스테이지할 수 있다. */
export function ChangeList({
  changes,
  isSelected,
  stats = {},
  action,
  onOpen,
  menu,
}: {
  changes: FileChange[];
  isSelected: (c: FileChange) => boolean;
  stats?: Record<string, LineStat>;
  action?: { icon: ReactNode; tip: string; run: (files: FileChange[]) => void };
  onOpen: (c: FileChange) => void;
  menu: (c: FileChange) => MenuItem[];
}) {
  const mode = useFileViewMode();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const indent = 14;

  const fileRow = (c: FileChange, showDir: boolean, pad = 0) => {
    const stat = stats[c.path];
    return (
      <div
        key={changeId(c)}
        className={`file-row ${isSelected(c) ? "selected" : ""}`}
        style={{ paddingLeft: 6 + pad }}
        onClick={() => onOpen(c)}
        onContextMenu={(e) => showContextMenu(e, menu(c))}
        data-tip={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
      >
        <StatusBadge kind={c.kind} />
        <span className="ellipsis" style={{ flex: "0 1 auto" }}>
          {fileName(c.path)}
        </span>
        {(c.oldPath || showDir) && (
          <span className="ellipsis muted" style={{ fontSize: 11.5, direction: "rtl", textAlign: "left", flex: "1 1 0" }}>
            {c.oldPath ? `← ${showDir ? c.oldPath : fileName(c.oldPath)}` : fileDir(c.path)}
          </span>
        )}
        <span className="spacer" />
        {stat && (stat.added !== null && stat.deleted !== null ? <LineStatText added={stat.added} deleted={stat.deleted} /> : <span className="faint" style={{ fontSize: 11 }}>바이너리</span>)}
        {action && (
          <IconButton
            small
            className="act"
            icon={action.icon}
            tip={action.tip}
            onClick={(e) => {
              e.stopPropagation();
              action.run([c]);
            }}
          />
        )}
      </div>
    );
  };

  if (mode === "list") return <div className="col">{changes.map((c) => fileRow(c, true))}</div>;

  const toggle = (p: string) => {
    const s = new Set(collapsed);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    setCollapsed(s);
  };
  return (
    <div className="col">
      {treeRows(changes, collapsed).map((r) =>
        r.kind === "folder" ? (
          <div key={r.id} className="file-row" style={{ paddingLeft: 6 + r.depth * indent }} onClick={() => toggle(r.path)}>
            <span className="muted" style={{ display: "inline-flex", width: 12 }}>
              {collapsed.has(r.path) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <span style={{ color: "var(--accent)", display: "inline-flex" }}>{collapsed.has(r.path) ? <Folder size={14} /> : <FolderOpen size={14} />}</span>
            <span className="ellipsis">{r.name}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {r.files.length}
            </span>
            <span className="spacer" />
            {action && (
              <IconButton
                small
                className="act"
                icon={action.icon}
                tip={action.tip + " — 폴더 전체"}
                onClick={(e) => {
                  e.stopPropagation();
                  action.run(r.files);
                }}
              />
            )}
          </div>
        ) : (
          fileRow(r.change, false, r.depth * indent + indent)
        ),
      )}
    </div>
  );
}
