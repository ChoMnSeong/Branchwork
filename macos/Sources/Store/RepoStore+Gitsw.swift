import Foundation

extension RepoStore {
    /// gitsw 가 보는 이 저장소의 계정과 점검을 다시 읽는다. fetch 면 원격을 받아 받을 커밋까지 본다(몇 초).
    func refreshGitsw(fetch: Bool = false) async {
        guard let url, Gitsw.hasConfig else {
            if gitswStatus != nil { gitswStatus = nil }
            if gitswPreflight != nil { gitswPreflight = nil }
            if !gitswAccounts.isEmpty { gitswAccounts = [] }
            return
        }
        gitswChecking = true
        async let s = Gitsw.status(in: url)
        async let p = Gitsw.preflight(in: url, fetch: fetch)
        async let a = Gitsw.accounts()
        let (status, preflight, accounts) = await (s, p, a)
        gitswChecking = false
        guard self.url == url else { return }
        let managed = status?.inRepo == true ? status : nil
        let checks = managed == nil ? nil : preflight
        // 같은 값이면 다시 넣지 않는다(화면을 다시 그리지 않게)
        if gitswStatus != managed { gitswStatus = managed }
        if gitswPreflight != checks { gitswPreflight = checks }
        if gitswAccounts != accounts { gitswAccounts = accounts }
    }

    /// 이 저장소를 다른 gitsw 계정으로(gitsw use): 작성자·원격 주소·잠금이 바뀌므로 작성자·원격·점검을 다시 읽는다
    func useGitswAccount(_ id: String) async {
        guard let url else { return }
        do {
            try await Gitsw.use(id, in: url)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        await loadRepoInfo(in: url)
        await reload()
        await refreshGitsw()
    }
}
