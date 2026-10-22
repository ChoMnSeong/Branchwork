import Foundation

/// PR·MR 리뷰: 대화·바뀐 파일·승인을 오른쪽 상세에서
extension RepoStore {
    private struct ReviewAccess { let target: RepoTarget; let token: String; let apiBase: String; let me: String }

    private var reviewAccess: ReviewAccess? {
        guard let t = target, let a = hostingAccount, let token = AccountStore.shared.token(for: a) else { return nil }
        return ReviewAccess(target: t, token: token, apiBase: a.apiBase, me: a.username)
    }

    func loadReview(_ number: Int) async {
        guard let c = reviewAccess else { reviewError = "계정을 연결하면 대화·승인을 볼 수 있습니다."; return }
        if review?.number != number { review = nil }
        reviewLoading = true
        reviewError = nil
        defer { reviewLoading = false }
        do {
            let r = try await ReviewAPI.load(c.target, token: c.token, apiBase: c.apiBase, number: number, me: c.me)
            guard selection == .pullRequest(number) else { return }
            review = r
        } catch {
            guard selection == .pullRequest(number) else { return }
            reviewError = describe(error)
        }
    }

    /// 버튼 동작 공통: 실패하면 권한 안내를 덧붙이고, 성공하면 다시 읽는다
    private func reviewAction(_ number: Int, _ work: (ReviewAccess) async throws -> Void) async -> Bool {
        guard let c = reviewAccess, !reviewBusy else { return false }
        reviewBusy = true
        defer { reviewBusy = false }
        do {
            try await work(c)
        } catch {
            var msg = describe(error)
            if let h = error as? HostingError, h.status == 403 || h.status == 404 || h.status == 422 {
                msg += c.target.provider == .gitlab
                    ? "\n\n토큰에 api 권한이 있어야 하고, 승인은 그 MR 을 승인할 수 있는 사람만 할 수 있습니다."
                    : "\n\n토큰에 pull request 쓰기 권한(클래식 토큰은 repo)이 있어야 합니다. 내가 만든 PR 은 스스로 승인할 수 없습니다."
            }
            errorMessage = msg
            return false
        }
        await loadReview(number)
        return true
    }

    func postReviewComment(_ number: Int, body: String) async -> Bool {
        await reviewAction(number) { c in try await ReviewAPI.comment(c.target, token: c.token, apiBase: c.apiBase, number: number, body: body) }
    }

    func approvePullRequest(_ number: Int, body: String) async -> Bool {
        await reviewAction(number) { c in try await ReviewAPI.approve(c.target, token: c.token, apiBase: c.apiBase, number: number, body: body) }
    }

    func unapprovePullRequest(_ number: Int) async {
        _ = await reviewAction(number) { c in try await ReviewAPI.unapprove(c.target, token: c.token, apiBase: c.apiBase, number: number) }
    }

    func requestChanges(_ number: Int, body: String) async -> Bool {
        await reviewAction(number) { c in try await ReviewAPI.requestChanges(c.target, token: c.token, apiBase: c.apiBase, number: number, body: body) }
    }

    /// 바뀐 파일을 누르면 가운데에 그 파일의 diff(PR 의 패치로)
    func openReviewFile(_ number: Int, _ f: ReviewFile) {
        openDiff(.review(number: number, change: f.change, patch: f.patch ?? ""))
    }
}
