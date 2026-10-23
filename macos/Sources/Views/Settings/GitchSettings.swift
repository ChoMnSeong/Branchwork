import SwiftUI
import AppKit

/// 설정 > CLI 의 gitch(예전 이름 gitsw): 앱에 든 gitch 를 셸 명령으로 설치한다. 계정 더하기·진단은 묻는 것이 있어 Terminal 에서.
struct GitchSection: View {
    /// Terminal 에서 계정을 더하고 돌아오면 다시 읽으려고
    @ViewState private var generation = 0
    @ViewState private var confirmInstall = false
    @ViewState private var busy = false
    @ViewState private var result: String?
    @ViewState private var error: String?
    @ViewState private var accounts: [Gitch.Account] = []

    var body: some View {
        let _ = generation
        let installed = Gitch.installed
        let bundledVersion = Gitch.bundled.flatMap(Gitch.version(at:))
        Section {
            Text("gitch keeps several Git accounts apart: it locks each repository to an account, picks the account by folder or organization, and blocks wrong authors, secrets and force pushes in git hooks, in the terminal, for AI agents and in Gitrochi.")
                .font(.callout).foregroundStyle(.secondary)
            LabeledContent("Version in Gitrochi") { Text(bundledVersion ?? "—").font(.callout.monospaced()) }
            LabeledContent("Shell command") {
                Text(installed.map { "\(Gitch.installedName ?? "~/bin/gitch") → \(tilde($0))" + (Gitch.version(at: $0).map { " (\($0))" } ?? "") } ?? "—")
                    .font(.callout.monospaced())
                    .lineLimit(1).truncationMode(.head)
                    .textSelection(.enabled)
            }
            LabeledContent("Accounts") {
                if accounts.isEmpty { Text("None yet") } else { Text(verbatim: "\(accounts.count)") }
            }
            ForEach(accounts) { a in accountRow(a) }
            HStack {
                Button("Add an account in Terminal…") { run { try Gitch.openInTerminal(["add"]) } }
                Button(Gitch.installedIsBundled ? "Reinstall…" : "Install…") { confirmInstall = true }
                    .disabled(!Gitch.hasConfig || busy || bundledVersion == nil)
                Button("Run doctor in Terminal") { run { try Gitch.openInTerminal(["doctor"]) } }
                    .disabled(Gitch.executable == nil)
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
                Text(verbatim: "gitch")
                Spacer()
                if installed == nil {
                    Text("Not installed").font(.caption).foregroundStyle(.orange)
                } else if Gitch.installedIsBundled {
                    Text("Installed").font(.caption).foregroundStyle(Color.accentColor)
                } else {
                    Text("Installed from another copy").font(.caption).foregroundStyle(.secondary)
                }
            }
        } footer: {
            Text(Gitch.hasConfig
                 ? String(localized: "Open a new terminal window to start using gitch.")
                 : String(localized: "Add an account first: gitch add asks for the account's name, email and server and makes an SSH key for it. Then install."))
                .font(.caption).foregroundStyle(.secondary)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in generation += 1 }
        .task(id: generation) { accounts = await Gitch.accounts() }
        .alert("Install gitch?", isPresented: $confirmInstall) {
            Button("Cancel", role: .cancel) {}
            Button("Install") { install() }
        } message: {
            Text("This changes files outside Gitrochi, backing them up first:\n• ~/bin/gitch and the old name ~/bin/gitsw: link to the gitch inside Gitrochi\n• ~/.zshrc: adds a gitch block\n• ~/.gitconfig: global hooks that check authors, secrets, big files and force pushes, and rules that pick the account\n• ~/.claude and ~/.codex: rules, skills and a hook for AI agents\nRemove it later with gitch uninstall.")
        }
    }

    /// 계정 하나: 아이디 · 이메일, 서버 · 규칙(gitch 문구 그대로), SSH 키가 없으면 만들기
    private func accountRow(_ a: Gitch.Account) -> some View {
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
                Button("Set up SSH key in Terminal…") { run { try Gitch.openInTerminal(["setup", a.id]) } }
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
                result = try await Gitch.install().split(separator: "\n").suffix(6).joined(separator: "\n")
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
