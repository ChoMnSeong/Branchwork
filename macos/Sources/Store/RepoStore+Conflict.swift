import Foundation

/// 충돌 해결: 충돌 난 파일을 블록마다 고르고 저장한 뒤 해결됨으로 표시
extension RepoStore {
    /// 지금 진행 중인 작업에 맞는 양쪽 이름(머지·리베이스에서 '내 것'의 뜻이 다르다)
    var conflictSides: (ours: String, theirs: String) {
        switch repoState {
        case .rebasing: return ("기준(위로 올리는 곳)", "내 커밋")
        case .cherryPicking: return ("현재 브랜치", "가져오는 커밋")
        case .reverting: return ("현재 브랜치", "되돌리는 변경")
        default: return ("현재 브랜치", "머지하는 브랜치")
        }
    }

    func loadConflict(_ c: FileChange) {
        guard let url else { return }
        let text = (try? String(contentsOf: url.appendingPathComponent(c.path), encoding: .utf8)) ?? ""
        conflictPath = c.path
        conflictDoc = ConflictDocument.parse(text)
        conflictChoices = [:]
    }

    func chooseConflict(_ block: Int, _ choice: ConflictDocument.Choice?) {
        conflictChoices[block] = choice
    }

    /// 고른 대로 파일을 쓰고 해결됨으로 표시(스테이지)
    func saveConflictResolution(_ c: FileChange) async {
        guard let url, let doc = conflictDoc, let text = doc.resolved(conflictChoices) else { return }
        do {
            try Data(text.utf8).write(to: url.appendingPathComponent(c.path), options: .atomic)
        } catch {
            errorMessage = "파일을 저장하지 못했습니다.\n\n" + describe(error)
            return
        }
        if await run("해결됨으로 표시 중…", ["add", "--", c.path]) { closeConflict() }
    }

    /// 파일 전체를 한쪽으로(git checkout --ours/--theirs)
    func resolveWholeFile(_ c: FileChange, ours: Bool) async {
        guard await run("충돌 해결 중…", ["checkout", ours ? "--ours" : "--theirs", "--", c.path]) else { return }
        if await run("해결됨으로 표시 중…", ["add", "--", c.path]) { closeConflict() }
    }

    /// 한쪽이 지운 파일: 남기기(스테이지) 또는 지우기
    func resolveDeleted(_ c: FileChange, keep: Bool) async {
        if await run("충돌 해결 중…", keep ? ["add", "--", c.path] : ["rm", "-q", "--", c.path]) { closeConflict() }
    }

    func closeConflict() {
        conflictDoc = nil
        conflictChoices = [:]
        conflictPath = nil
    }
}
