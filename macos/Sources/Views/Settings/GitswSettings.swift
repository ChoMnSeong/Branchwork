import SwiftUI
import AppKit

/// 설정 > 도구의 gitsw: 앱에 든 gitsw 를 셸 명령으로 설치한다. 계정 더하기·진단은 묻는 것이 있어 Terminal 에서.
struct GitswSection: View {
    /// Terminal 에서 계정을 더하고 돌아오면 다시 읽으려고
    @ViewState private var generation = 0
    @ViewState private var confirmInstall = false
    @ViewState private var busy = false
    @ViewState private var result: String?
    @ViewState private var error: String?
    @ViewState private var accounts: [Gitsw.Account] = []

    var body: some View {
        let _ = generation
        let installed = Gitsw.installed
        let bundledVersion = Gitsw.bundled.flatMap(Gitsw.version(at:))
        Section {
            Text("gitsw keeps several Git accounts apart: it locks each repository to an account, picks the account by folder or organization, and blocks wrong authors, secrets and force pushes in git hooks, in the terminal, for AI agents and in Branchwork.")
                .font(.callout).foregroundStyle(.secondary)
            LabeledContent("Version in Branchwork") { Text(bundledVersion ?? "—").font(.callout.monospaced()) }
            LabeledContent("Shell command") {
                Text(installed.map { "~/bin/gitsw → \(tilde($0))" + (Gitsw.version(at: $0).map { " (\($0))" } ?? "") } ?? "—")
                    .font(.callout.monospaced())
                    .lineLimit(1).truncationMode(.head)
                    .textSelection(.enabled)
            }
            LabeledContent("Accounts") {
                if accounts.isEmpty { Text("None yet") } else { Text(verbatim: "\(accounts.count)") }
            }
            ForEach(accounts) { a in accountRow(a) }
            HStack {
                Button("Add an account in Terminal…") { run { try Gitsw.openInTerminal(["add"]) } }
                Button(Gitsw.installedIsBundled ? "Reinstall…" : "Install…") { confirmInstall = true }
                    .disabled(!Gitsw.hasConfig || busy || bundledVersion == nil)
                Button("Run doctor in Terminal") { run { try Gitsw.openInTerminal(["doctor"]) } }
                    .disabled(Gitsw.executable == nil)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
            }
            if let result {
                Text(result).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        } header: {
            HStack {
                Text(verbatim: "gitsw")
                Spacer()
                if installed == nil {
                    Text("Not installed").font(.caption).foregroundStyle(.orange)
                } else if Gitsw.installedIsBundled {
                    Text("Installed").font(.caption).foregroundStyle(Color.accentColor)
                } else {
                    Text("Installed from another copy").font(.caption).foregroundStyle(.secondary)
                }
            }
        } footer: {
            Text(Gitsw.hasConfig
                 ? String(localized: "Open a new terminal window to start using gitsw.")
                 : String(localized: "Add an account first: gitsw add asks for the account's name, email and server and makes an SSH key for it. Then install."))
                .font(.caption).foregroundStyle(.secondary)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in generation += 1 }
        .task(id: generation) { accounts = await Gitsw.accounts() }
        .alert("Install gitsw?", isPresented: $confirmInstall) {
            Button("Cancel", role: .cancel) {}
            Button("Install") { install() }
        } message: {
            Text("This changes files outside Branchwork, backing them up first:\n• ~/bin/gitsw: links to the gitsw inside Branchwork\n• ~/.zshrc: adds a gitsw block\n• ~/.gitconfig: global hooks that check authors, secrets, big files and force pushes, and rules that pick the account\n• ~/.claude and ~/.codex: rules, skills and a hook for AI agents\nRemove it later with gitsw uninstall.")
        }
    }

    /// 계정 하나: 아이디 · 이메일, 서버 · 규칙(gitsw 문구 그대로), SSH 키가 없으면 만들기
    private func accountRow(_ a: Gitsw.Account) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(verbatim: a.id).font(.callout.weight(.semibold))
                    Text(verbatim: a.email).font(.callout).foregroundStyle(.secondary)
                }
                Text(verbatim: [a.hosts, a.rules ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            if a.sshKey == false {
                Button("Set up SSH key in Terminal…") { run { try Gitsw.openInTerminal(["setup", a.id]) } }
                    .controlSize(.small)
            }
        }
    }

    private func install() {
        busy = true
        error = nil
        result = nil
        Task {
            do {
                // 마지막 몇 줄(설치 완료 안내)만 보여 준다
                result = try await Gitsw.install().split(separator: "\n").suffix(6).joined(separator: "\n")
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            busy = false
            generation += 1
        }
    }

    private func run(_ action: () throws -> Void) {
        error = nil
        do { try action() } catch { self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
    }

    private func tilde(_ path: String) -> String {
        path.hasPrefix(NSHomeDirectory()) ? "~" + path.dropFirst(NSHomeDirectory().count) : path
    }
}
