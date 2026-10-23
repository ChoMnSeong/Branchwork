import Foundation

extension RepoStore {
    /// gitch 가 보는 이 저장소의 계정과 점검을 다시 읽는다. fetch 면 원격을 받아 받을 커밋까지 본다(몇 초).
    func refreshGitch(fetch: Bool = false) async {
        guard let url, Gitch.hasConfig else {
            if gitchStatus != nil { gitchStatus = nil }
            if gitchPreflight != nil { gitchPreflight = nil }
            if !gitchAccounts.isEmpty { gitchAccounts = [] }
            return
        }
        gitchChecking = true
        async let s = Gitch.status(in: url)
        async let p = Gitch.preflight(in: url, fetch: fetch)
        async let a = Gitch.accounts()
        let (status, preflight, accounts) = await (s, p, a)
        gitchChecking = false
        guard self.url == url else { return }
        let managed = status?.inRepo == true ? status : nil
        let checks = managed == nil ? nil : preflight
        // 같은 값이면 다시 넣지 않는다(화면을 다시 그리지 않게)
        if gitchStatus != managed { gitchStatus = managed }
        if gitchPreflight != checks { gitchPreflight = checks }
        if gitchAccounts != accounts { gitchAccounts = accounts }
    }

    /// 이 저장소를 다른 gitch 계정으로(gitch use): 작성자·원격 주소·잠금이 바뀌므로 작성자·원격·점검을 다시 읽는다
    func useGitchAccount(_ id: String) async {
        guard let url else { return }
        do {
            try await Gitch.use(id, in: url)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        await loadRepoInfo(in: url)
        await reload()
        await refreshGitch()
    }
}
