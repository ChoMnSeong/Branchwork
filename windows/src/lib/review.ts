import * as Hosting from "./hosting";
import type { ChangeKind, FileChange, RepoTarget } from "./models";

/** PR(GitHub)·MR(GitLab) 리뷰: 대화·바뀐 파일·승인 (맥 버전 Services/ReviewAPI.swift) */

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  /** 유닉스 초 */
  date: number | null;
  /** 코드 줄 댓글이면 파일·줄 */
  path?: string;
  line?: number;
  kind: "comment" | "approved" | "changesRequested" | "system";
}

export interface ReviewFile {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
  additions: number;
  deletions: number;
  /** 덩어리(@@)만 있는 패치. 바이너리·너무 큰 파일이면 null */
  patch: string | null;
}

export interface ReviewState {
  approvedBy: string[];
  changesRequestedBy: string[];
  /** GitLab: 남은 승인 수 */
  approvalsLeft: number | null;
  approvedByMe: boolean;
}

export interface PullRequestReview {
  number: number;
  comments: ReviewComment[];
  files: ReviewFile[];
  state: ReviewState;
}

export interface ReviewAccess {
  target: RepoTarget;
  token: string;
  apiBase: string;
  me: string;
}

export const reviewFileChange = (f: ReviewFile): FileChange => ({ path: f.path, oldPath: f.oldPath, kind: f.kind, staged: false });

interface GHUser { login: string }
interface GHComment { id: number; user?: GHUser | null; body?: string | null; created_at?: string }
interface GHLineComment extends GHComment { path?: string; line?: number | null; original_line?: number | null }
interface GHReview { id: number; user?: GHUser | null; body?: string | null; state: string; submitted_at?: string }
interface GHFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string }
interface GLNote { id: number; author?: { username: string }; body: string; created_at?: string; system?: boolean; position?: { new_path?: string; new_line?: number; old_path?: string; old_line?: number } | null }
interface GLApprovals { approved_by?: { user: { username: string } }[]; approvals_left?: number }
interface GLChange { old_path: string; new_path: string; new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean; diff?: string }

const repo = (c: ReviewAccess) => `${c.apiBase}/repos/${c.target.path}`;
const project = (c: ReviewAccess) => `${c.apiBase}/projects/${Hosting.projectID(c.target.path)}`;

export const ReviewAPI = {
  async load(c: ReviewAccess, n: number): Promise<PullRequestReview> {
    const review: PullRequestReview = { number: n, comments: [], files: [], state: { approvedBy: [], changesRequestedBy: [], approvalsLeft: null, approvedByMe: false } };
    if (c.target.provider === "github") {
      const [comments, lines, reviews, files] = await Promise.all([
        Hosting.send<GHComment[]>("github", `${repo(c)}/issues/${n}/comments?per_page=100`, c.token),
        Hosting.send<GHLineComment[]>("github", `${repo(c)}/pulls/${n}/comments?per_page=100`, c.token),
        Hosting.send<GHReview[]>("github", `${repo(c)}/pulls/${n}/reviews?per_page=100`, c.token),
        Hosting.send<GHFile[]>("github", `${repo(c)}/pulls/${n}/files?per_page=100`, c.token),
      ]);
      review.comments.push(...comments.map((x): ReviewComment => ({ id: `c${x.id}`, author: x.user?.login ?? "", body: x.body ?? "", date: Hosting.date(x.created_at), kind: "comment" })));
      review.comments.push(
        ...lines.map((x): ReviewComment => ({ id: `l${x.id}`, author: x.user?.login ?? "", body: x.body ?? "", date: Hosting.date(x.created_at), path: x.path, line: x.line ?? x.original_line ?? undefined, kind: "comment" })),
      );
      const latest = new Map<string, string>();
      for (const r of reviews) {
        const who = r.user?.login ?? "";
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) latest.set(who, r.state);
        const kind = r.state === "APPROVED" ? "approved" : r.state === "CHANGES_REQUESTED" ? "changesRequested" : "comment";
        if (kind === "comment" && !r.body) continue;
        review.comments.push({ id: `r${r.id}`, author: who, body: r.body ?? "", date: Hosting.date(r.submitted_at), kind });
      }
      review.state.approvedBy = [...latest].filter(([, s]) => s === "APPROVED").map(([w]) => w).sort();
      review.state.changesRequestedBy = [...latest].filter(([, s]) => s === "CHANGES_REQUESTED").map(([w]) => w).sort();
      review.state.approvedByMe = latest.get(c.me) === "APPROVED";
      review.files = files.map((f) => ({
        path: f.filename,
        oldPath: f.previous_filename ?? null,
        kind: f.status === "added" ? "added" : f.status === "removed" ? "deleted" : f.status === "renamed" ? "renamed" : "modified",
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      }));
    } else {
      const [discussions, approvals, changes] = await Promise.all([
        Hosting.send<{ notes: GLNote[] }[]>("gitlab", `${project(c)}/merge_requests/${n}/discussions?per_page=100`, c.token),
        Hosting.send<GLApprovals>("gitlab", `${project(c)}/merge_requests/${n}/approvals`, c.token).catch(() => null),
        Hosting.send<{ changes: GLChange[] }>("gitlab", `${project(c)}/merge_requests/${n}/changes`, c.token),
      ]);
      review.comments = discussions
        .flatMap((d) => d.notes)
        .map((x) => ({
          id: `n${x.id}`,
          author: x.author?.username ?? "",
          body: x.body,
          date: Hosting.date(x.created_at),
          path: x.position?.new_path ?? x.position?.old_path,
          line: x.position?.new_line ?? x.position?.old_line,
          kind: x.system ? "system" : "comment",
        }));
      review.state.approvedBy = (approvals?.approved_by ?? []).map((a) => a.user.username);
      review.state.approvalsLeft = approvals?.approvals_left ?? null;
      review.state.approvedByMe = review.state.approvedBy.includes(c.me);
      review.files = changes.changes.map((x) => {
        const lines = (x.diff ?? "").split("\n");
        return {
          path: x.new_path,
          oldPath: x.renamed_file ? x.old_path : null,
          kind: x.new_file ? "added" : x.deleted_file ? "deleted" : x.renamed_file ? "renamed" : "modified",
          additions: lines.filter((l) => l.startsWith("+")).length,
          deletions: lines.filter((l) => l.startsWith("-")).length,
          patch: x.diff || null,
        };
      });
    }
    review.comments.sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
    return review;
  },

  comment: (c: ReviewAccess, n: number, body: string) =>
    c.target.provider === "github"
      ? Hosting.sendRaw("github", `${repo(c)}/issues/${n}/comments`, c.token, "POST", { body })
      : Hosting.sendRaw("gitlab", `${project(c)}/merge_requests/${n}/notes`, c.token, "POST", { body }),

  /** 승인(GitHub 은 의견을 함께 남길 수 있다) */
  async approve(c: ReviewAccess, n: number, body: string) {
    if (c.target.provider === "github") {
      await Hosting.sendRaw("github", `${repo(c)}/pulls/${n}/reviews`, c.token, "POST", body ? { event: "APPROVE", body } : { event: "APPROVE" });
    } else {
      await Hosting.sendRaw("gitlab", `${project(c)}/merge_requests/${n}/approve`, c.token, "POST");
      if (body) await ReviewAPI.comment(c, n, body);
    }
  },

  /** GitLab: 승인 취소 */
  unapprove: (c: ReviewAccess, n: number) => Hosting.sendRaw("gitlab", `${project(c)}/merge_requests/${n}/unapprove`, c.token, "POST"),

  /** GitHub: 변경 요청(의견 필수) */
  requestChanges: (c: ReviewAccess, n: number, body: string) => Hosting.sendRaw("github", `${repo(c)}/pulls/${n}/reviews`, c.token, "POST", { event: "REQUEST_CHANGES", body }),
};
