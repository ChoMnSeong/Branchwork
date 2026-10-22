import Foundation

/// 워크플로 입력값·파이프라인 변수를 읽을 만큼만 하는 YAML(블록 맵·목록·[a, b]·따옴표·| > 여러 줄 글)
enum MiniYAML {
    indirect enum Node {
        case scalar(String)
        case map([(String, Node)])
        case list([Node])

        subscript(key: String) -> Node? {
            if case .map(let pairs) = self { return pairs.first { $0.0 == key }?.1 }
            return nil
        }
        var string: String? {
            if case .scalar(let s) = self { return s }
            return nil
        }
        var pairs: [(String, Node)] {
            if case .map(let p) = self { return p }
            return []
        }
        var items: [Node] {
            if case .list(let l) = self { return l }
            return []
        }
    }

    private struct Line { let indent: Int; let text: String; let raw: String; let blank: Bool }

    static func parse(_ text: String) -> Node {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map { sub -> Line in
            let raw = String(sub).replacingOccurrences(of: "\t", with: "  ")
            let body = stripComment(raw)
            let trimmed = body.trimmingCharacters(in: .whitespaces)
            let indent = raw.prefix { $0 == " " }.count
            return Line(indent: indent, text: trimmed, raw: raw, blank: trimmed.isEmpty || trimmed == "---")
        }
        var i = 0
        skipBlank(lines, &i)
        guard i < lines.count else { return .map([]) }
        return block(lines, &i, lines[i].indent)
    }

    /// 따옴표 밖의 " #" 뒤는 주석
    private static func stripComment(_ s: String) -> String {
        var quote: Character?
        var prev: Character = " "
        for (n, c) in s.enumerated() {
            if let q = quote {
                if c == q { quote = nil }
            } else if c == "'" || c == "\"" {
                quote = c
            } else if c == "#", prev == " " || prev == "\t" || n == 0 {
                return String(s.prefix(n))
            }
            prev = c
        }
        return s
    }

    private static func skipBlank(_ lines: [Line], _ i: inout Int) {
        while i < lines.count, lines[i].blank { i += 1 }
    }

    private static func isItem(_ t: String) -> Bool { t == "-" || t.hasPrefix("- ") }

    private static func block(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        isItem(lines[i].text) ? list(lines, &i, indent) : map(lines, &i, indent)
    }

    /// "key: value" → (key, value). 값이 없으면 value 는 빈 문자열.
    private static func splitKey(_ t: String) -> (String, String)? {
        var quote: Character?
        let chars = Array(t)
        for n in chars.indices {
            let c = chars[n]
            if let q = quote {
                if c == q { quote = nil }
                continue
            }
            if (c == "'" || c == "\"") && n == 0 { quote = c; continue }
            if c == ":" && (n == chars.count - 1 || chars[n + 1] == " ") {
                let key = unquote(String(chars[..<n]).trimmingCharacters(in: .whitespaces))
                let value = n == chars.count - 1 ? "" : String(chars[(n + 1)...]).trimmingCharacters(in: .whitespaces)
                return (key, value)
            }
        }
        return nil
    }

    private static func map(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        var pairs: [(String, Node)] = []
        while i < lines.count {
            let l = lines[i]
            if l.blank { i += 1; continue }
            if l.indent < indent || (l.indent == indent && isItem(l.text)) { break }
            if l.indent > indent { i += 1; continue }       // 예상 밖의 들여쓰기는 건너뜀
            guard let (key, value) = splitKey(l.text) else { i += 1; continue }
            i += 1
            pairs.append((key, valueNode(value, lines, &i, indent)))
        }
        return .map(pairs)
    }

    private static func list(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        var items: [Node] = []
        while i < lines.count {
            let l = lines[i]
            if l.blank { i += 1; continue }
            guard l.indent == indent, isItem(l.text) else {
                if l.indent > indent { i += 1; continue }
                break
            }
            let rest = String(l.text.dropFirst()).trimmingCharacters(in: .whitespaces)
            if rest.isEmpty {
                i += 1
                skipBlank(lines, &i)
                if i < lines.count, lines[i].indent > indent { items.append(block(lines, &i, lines[i].indent)) } else { items.append(.scalar("")) }
            } else if splitKey(rest) != nil, !rest.hasPrefix("[") , !rest.hasPrefix("{") {
                // "- key: value" 로 시작하는 맵: 그 줄을 맵의 첫 줄로 다시 읽는다
                let inner = indent + (l.text.count - rest.count)
                var copy = lines
                copy[i] = Line(indent: inner, text: rest, raw: l.raw, blank: false)
                var j = i
                items.append(map(copy, &j, inner))
                i = j
            } else {
                i += 1
                items.append(scalarNode(rest))
            }
        }
        return .list(items)
    }

    private static func valueNode(_ value: String, _ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        if value.isEmpty {
            var j = i
            skipBlank(lines, &j)
            guard j < lines.count else { i = j; return .scalar("") }
            let next = lines[j]
            if next.indent > indent || (next.indent == indent && isItem(next.text)) {
                i = j
                return block(lines, &i, next.indent)
            }
            return .scalar("")
        }
        if let first = value.first, first == "|" || first == ">" {
            // 여러 줄 글: 더 깊이 들여쓴 줄을 모두
            var raws: [String] = []
            var minIndent = Int.max
            while i < lines.count, lines[i].blank || lines[i].indent > indent {
                let l = lines[i]
                if !l.raw.trimmingCharacters(in: .whitespaces).isEmpty { minIndent = min(minIndent, l.indent) }
                raws.append(l.raw)
                i += 1
            }
            let cut = minIndent == .max ? 0 : minIndent
            let body = raws.map { $0.count >= cut ? String($0.dropFirst(cut)) : "" }
            let joined = first == "|" ? body.joined(separator: "\n") : body.joined(separator: " ")
            return .scalar(joined.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return scalarNode(value)
    }

    private static func scalarNode(_ v: String) -> Node {
        if v.hasPrefix("[") && v.hasSuffix("]") {
            let inner = v.dropFirst().dropLast()
            return .list(splitFlow(String(inner)).map { .scalar(unquote($0)) })
        }
        if v.hasPrefix("{") && v.hasSuffix("}") {
            let inner = v.dropFirst().dropLast()
            return .map(splitFlow(String(inner)).compactMap { part in
                splitKey(part).map { ($0.0, .scalar(unquote($0.1))) } ?? (unquote(part), .scalar(""))
            })
        }
        return .scalar(unquote(v))
    }

    /// "a, 'b, c', d" → ["a", "'b, c'", "d"]
    private static func splitFlow(_ s: String) -> [String] {
        var parts: [String] = [], cur = "", quote: Character?
        for c in s {
            if let q = quote {
                if c == q { quote = nil }
                cur.append(c)
            } else if c == "'" || c == "\"" {
                quote = c
                cur.append(c)
            } else if c == "," {
                parts.append(cur.trimmingCharacters(in: .whitespaces))
                cur = ""
            } else {
                cur.append(c)
            }
        }
        let last = cur.trimmingCharacters(in: .whitespaces)
        if !last.isEmpty { parts.append(last) }
        return parts.filter { !$0.isEmpty }
    }

    static func unquote(_ s: String) -> String {
        if s.count >= 2, s.hasPrefix("'"), s.hasSuffix("'") {
            return String(s.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
        }
        if s.count >= 2, s.hasPrefix("\""), s.hasSuffix("\"") {
            return String(s.dropFirst().dropLast())
                .replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\\"", with: "\"")
                .replacingOccurrences(of: "\\\\", with: "\\")
        }
        return s
    }

    // MARK: 쓰임새

    /// GitHub 워크플로 파일: workflow_dispatch 가 있으면 그 입력값(없으면 nil)
    static func dispatchInputs(_ text: String) -> [CIInput]? {
        let root = parse(text)
        guard let on = root["on"] ?? root["true"] else { return nil }
        switch on {
        case .scalar(let s): return s == "workflow_dispatch" ? [] : nil
        case .list(let l): return l.contains { $0.string == "workflow_dispatch" } ? [] : nil
        case .map:
            guard let wd = on["workflow_dispatch"] else { return nil }
            return (wd["inputs"]?.pairs ?? []).map { name, spec in
                let type = spec["type"]?.string ?? "string"
                return CIInput(name: name, description: spec["description"]?.string ?? "",
                               required: spec["required"]?.string == "true",
                               defaultValue: spec["default"]?.string ?? "", type: type,
                               options: (spec["options"]?.items ?? []).compactMap(\.string))
            }
        }
    }

    /// .gitlab-ci.yml: 설명이 있는 전역 변수(GitLab 의 "파이프라인 실행" 화면에 미리 채워지는 것)
    static func pipelineVariables(_ text: String) -> [CIInput] {
        (parse(text)["variables"]?.pairs ?? []).compactMap { name, spec in
            guard case .map = spec, let desc = spec["description"]?.string else { return nil }
            let options = (spec["options"]?.items ?? []).compactMap(\.string)
            return CIInput(name: name, description: desc, required: false, defaultValue: spec["value"]?.string ?? "",
                           type: options.isEmpty ? "string" : "choice", options: options)
        }
    }
}
