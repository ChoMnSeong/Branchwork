import Foundation

extension RepoStore {
    /// gitch 가 보는 이 저장소의 계정과 점검을 다시 읽는다. fetch 면 원격을 받아 받을 커밋까지 본다(몇 초).
    func refreshGitch(fetch: Bool = false) async {
        guard let url, Gitch.hasConfig else {
            if gitchStatus != nil { gitchStatus = nil }
            if gitchPreflight != nil { gitchPreflight = nil }
            if !gitchAccounts.isEmpty { gitchAccounts = [] }
            if !gitchProtected.isEmpty { gitchProtected = [] }
            return
        }
        gitchChecking = true
        async let s = Gitch.status(in: url)
        async let p = Gitch.preflight(in: url, fetch: fetch)
        async let a = Gitch.accounts()
        async let b = Git.run(["config", "--get-all", "gitswitch.protect"], in: url, ok: [0, 1])
        let (status, preflight, accounts, protected) = await (s, p, a, try? b)
        gitchChecking = false
        guard self.url == url else { return }
        let managed = status?.inRepo == true ? status : nil
        let checks = managed == nil ? nil : preflight
        let branches = Set((protected?.output ?? "").split(separator: "\n").map(String.init))
        // 같은 값이면 다시 넣지 않는다(화면을 다시 그리지 않게)
        if gitchStatus != managed { gitchStatus = managed }
        if gitchPreflight != checks { gitchPreflight = checks }
        if gitchAccounts != accounts { gitchAccounts = accounts }
        if gitchProtected != branches { gitchProtected = branches }
    }

    /// gitch 명령으로 이 저장소를 바꾸고 작성자·그래프·gitch 상태를 다시 읽는다. 실패하면 gitch 가 낸 문구를 보여 준다.
    /// gitch 는 브랜치를 옮기기 전에 스스로 백업하므로(gitch rescue) 앱의 되돌리기 기록에는 넣지 않는다.
    @discardableResult
    func runGitch(_ args: [String]) async -> Bool {
        guard let url, busy == nil else { return false }
        busy = String(localized: "Running gitch…")
        defer { busy = nil }
        var ok = true
        do {
            try await Gitch.run(args, in: url, timeout: 900)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            ok = false
        }
        await loadRepoInfo(in: url)
        await reload(quiet: !ok)
        await refreshGitch()
        return ok
    }

    /// 이 저장소를 다른 gitch 계정으로(gitch use): 작성자·원격 주소·잠금이 바뀐다
    func useGitchAccount(_ id: String) async { await runGitch(["use", id]) }

    /// 계정 잠금 풀기(작성자 설정은 그대로)
    func unlockGitch() async { await runGitch(["unlock", "--yes"]) }

    /// gitch 검사(작성자·비밀값·push)에서 빼거나 되돌리기
    func setGitchIgnored(_ ignored: Bool) async { await runGitch(ignored ? ["ignore", "--yes"] : ["ignore", "--off"]) }

    /// 직접 push 를 막는 브랜치로(다른 브랜치에서 PR 로만 합치게)
    func setGitchProtected(_ branch: String, _ protected: Bool) async {
        await runGitch(protected ? ["protect", branch] : ["protect", "--rm", branch])
    }

    /// 기본 브랜치 최신을 따라가기(gitch up): push 전이면 rebase, push 한 브랜치면 merge
    func gitchUp() async { await runGitch(["up"]) }

    /// 포크를 원본(upstream) 최신으로(gitch sync)
    func gitchSync() async { await runGitch(["sync"]) }

    /// push 안 한 커밋 중 작성자가 이 저장소 계정이 아닌 것. 고칠 것이 있으면 needsFix 와 gitch 가 낸 목록
    func gitchFixPreview() async -> (needsFix: Bool, text: String)? {
        guard let url else { return nil }
        do {
            let r = try await Gitch.runRaw(["fix"], in: url)
            // 2 = 고칠 커밋이 있어 확인이 필요(목록은 출력에), 0 = 고칠 것 없음
            if r.status == 2 { return (true, r.output.replacingOccurrences(of: "\n확인이 필요합니다.*", with: "", options: .regularExpression)) }
            if r.status == 0 { return (false, r.output) }
            errorMessage = r.output
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        return nil
    }

    func gitchFix() async { await runGitch(["fix", "--yes"]) }

    func gitchBackups() async -> [Gitch.Backup] {
        guard let url else { return [] }
        return await Gitch.backups(in: url)
    }

    /// 백업으로 되돌리기(지금 상태도 먼저 백업) 또는 새 브랜치로 꺼내기. 번호는 실행 직전에 다시 찾는다(그 사이 백업이 늘 수 있어서).
    @discardableResult
    func gitchRestore(_ backup: Gitch.Backup, toBranch branch: String?) async -> Bool {
        guard let index = await gitchBackups().firstIndex(where: { $0.ref == backup.ref }) else {
            errorMessage = String(localized: "That backup no longer exists.")
            return false
        }
        let pick = String(index + 1)
        if let branch { return await runGitch(["rescue", pick, "--branch", branch]) }
        return await runGitch(["rescue", pick, "--restore", "--yes"])
    }
}
