import Foundation

enum AIPrompts {
    static let commit = """
    You write git commit messages for the staged changes the user sends.
    Reply with the commit message only: no preamble, no code fences, no quotation marks.
    First line: a concise summary of at most 72 characters in the imperative mood.
    If the change needs explanation, add a blank line and a short body saying what changed and why.
    Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in \(AppLanguage.englishName).
    """

    static let explain = """
    You explain a git commit to a developer who is reviewing the history. Answer in \(AppLanguage.englishName).
    Start with one sentence on what the commit does. Then list the key changes as short "-" bullets, naming files and functions.
    End with anything risky or worth a closer look, or say that nothing stands out.
    Be concrete and brief. Plain text only, no headings.
    """

    static let split = """
    You split a set of uncommitted git changes into a sequence of small, focused commits.
    Group files that belong to the same logical change (one feature, one fix, one refactor, docs, config …). Every listed file must appear in exactly one commit; never invent paths.
    Order the commits so each one builds on the previous (shared refactors and dependencies first).
    Write each commit message as a commit message for that group: a summary line of at most 72 characters, optionally a blank line and a short body.
    Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in \(AppLanguage.englishName).
    Reply with JSON only, no code fences, exactly in this shape: {"commits":[{"message":"summary\\n\\noptional body","files":["path/one","path/two"]}]}
    """

    static let pullRequest = """
    You write pull request descriptions from the commits and diff the user sends.
    Reply in exactly this shape: the first line is the title (at most 72 characters, no "Title:" prefix), then a blank line, then the description in Markdown.
    The description has a short summary paragraph, a bulleted list of the main changes, and a short note on how to test if the changes suggest one.
    Use the same language as the commit messages; if unclear, write in \(AppLanguage.englishName). Output nothing else.
    """

    /// 너무 긴 입력은 앞부분만 보내고, 잘렸으면 생략한 글자 수를 돌려준다.
    static func clip(_ s: String, limit: Int = 400_000) -> (text: String, omitted: Int) {
        guard s.count > limit else { return (s, 0) }
        let head = String(s.prefix(limit))
        return (head + String(localized: "\n\n[... \(s.count - limit) more characters omitted ...]"), s.count - limit)
    }

    /// 첫 줄(요약/제목)과 나머지(본문)로 나눈다. 코드 펜스·따옴표로 감쌌으면 벗긴다.
    static func split(_ text: String) -> (String, String) {
        var t = text.trimmed
        if t.hasPrefix("```") {
            t = t.split(separator: "\n", omittingEmptySubsequences: false).dropFirst().joined(separator: "\n")
            if t.hasSuffix("```") { t = String(t.dropLast(3)) }
            t = t.trimmed
        }
        let lines = t.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        var first = lines.first?.trimmed ?? ""
        if first.count > 1, first.hasPrefix("\""), first.hasSuffix("\"") { first = String(first.dropFirst().dropLast()) }
        return (first, lines.count > 1 ? lines[1].trimmed : "")
    }
}
