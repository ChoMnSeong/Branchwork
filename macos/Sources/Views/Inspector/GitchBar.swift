import SwiftUI

/// 커밋 칸 위: gitch 가 보는 이 저장소의 계정과 커밋·push 전 점검(gitch 계정을 만들어 두었을 때만).
/// 계정 이름을 눌러 이 저장소에 쓸 계정을 바꾼다(gitch use).
struct GitchBar: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var showChecks = false
    /// 바꾸기 전에 확인받을 계정
    @ViewState private var switching: Gitch.Account?

    var body: some View {
        if let s = store.gitchStatus {
            HStack(spacing: 5) {
                Text(verbatim: "gitch").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Image(systemName: s.account == nil ? "exclamationmark.triangle.fill" : s.lockedAccount != nil ? "lock.fill" : "person.fill")
                    .font(.caption2)
                    .foregroundStyle(s.account == nil ? Color.orange : Color.secondary)
                Menu {
                    ForEach(store.gitchAccounts) { a in
                        Button { switching = a } label: {
                            if a.id == s.lockedAccount {
                                Label { Text(verbatim: "\(a.id) · \(a.email)") } icon: { Image(systemName: "checkmark") }
                            } else {
                                Text(verbatim: "\(a.id) · \(a.email)")
                            }
                        }
                        .disabled(a.id == s.lockedAccount)
                    }
                } label: {
                    Text(s.account ?? String(localized: "No account"))
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .disabled(store.gitchAccounts.isEmpty)
                .help(summary(s) + "\n" + String(localized: "Click to use another gitch account for this repository."))
                if s.ignored == true {
                    Text("Not managed by gitch").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if store.gitchChecking { ProgressView().controlSize(.mini) }
                if let p = store.gitchPreflight {
                    Button { showChecks.toggle() } label: { GitchResultPill(result: p.result) }
                        .buttonStyle(.plain)
                        .help("gitch checks before commit and push")
                        .popover(isPresented: $showChecks, arrowEdge: .bottom) { GitchChecks() }
                }
            }
            .alert(Text("Use \(switching?.id ?? "") for this repository?"),
                   isPresented: Binding(get: { switching != nil }, set: { if !$0 { switching = nil } }),
                   presenting: switching) { a in
                Button("Cancel", role: .cancel) {}
                Button("Use this account") { Task { await store.useGitchAccount(a.id) } }
            } message: { a in
                Text("gitch sets the commit author to \(a.email) and points origin (and upstream) at \(a.id)'s SSH alias, then locks the repository to it.")
            }
        }
    }

    private func summary(_ s: Gitch.Status) -> String {
        guard let a = s.account else {
            return String(localized: "gitch doesn't know which account this repository uses. Lock it with gitch use <account>.")
        }
        var text = s.accountSource == "lock" ? String(localized: "Locked to \(a)") : String(localized: "\(a) (chosen by a gitch rule)")
        if let push = s.pushAccount, push != a { text += " · " + String(localized: "Pushes as \(push)") }
        return text
    }
}

/// 점검 결과(OK · WARN · STOP)
private enum GitchLevel {
    static func icon(_ level: String) -> String {
        switch level {
        case "OK": return "checkmark.circle.fill"
        case "WARN": return "exclamationmark.triangle.fill"
        default: return "xmark.octagon.fill"
        }
    }

    static func color(_ level: String) -> Color {
        switch level {
        case "OK": return .green
        case "WARN": return .orange
        default: return .red
        }
    }

    static func title(_ level: String) -> String {
        switch level {
        case "OK": return String(localized: "Ready")
        case "WARN": return String(localized: "Warning")
        default: return String(localized: "Blocked")
        }
    }
}

private struct GitchResultPill: View {
    let result: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: GitchLevel.icon(result))
            Text(GitchLevel.title(result))
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(GitchLevel.color(result))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(GitchLevel.color(result).opacity(0.15)))
    }
}

/// 점검 항목(문구는 gitch 가 낸 그대로)과 다시 점검하기
private struct GitchChecks: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("gitch checks before commit and push").font(.headline)
            if let p = store.gitchPreflight {
                ForEach(p.checks, id: \.self) { c in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: GitchLevel.icon(c.level)).foregroundStyle(GitchLevel.color(c.level))
                        Text(c.message).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            Divider()
            HStack {
                Button("Check again with fetch") { Task { await store.refreshGitch(fetch: true) } }
                    .disabled(store.gitchChecking)
                if store.gitchChecking { ProgressView().controlSize(.small) }
                Spacer()
                Button("Run doctor in Terminal") {
                    do { try Gitch.openInTerminal(["doctor"], in: store.url?.path) } catch {
                        self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 380)
    }
}
