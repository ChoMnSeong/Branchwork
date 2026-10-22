import SwiftUI
import AppKit

struct AccountsSettings: View {
    private let accounts = AccountStore.shared
    @ViewState private var githubToken = ""
    @ViewState private var gitlabServer = ""
    @ViewState private var gitlabToken = ""
    @ViewState private var working: Provider?
    @ViewState private var error: String?

    var body: some View {
        Form {
            Section {
                ForEach(accounts.accounts(for: .github)) { a in
                    ConnectedRow(account: a) { accounts.disconnect(a) }
                }
                SecureField("Personal access token", text: $githubToken, prompt: Text(accounts.accounts(for: .github).isEmpty ? "ghp_… 토큰" : "다른 계정의 토큰"))
                HStack {
                    Button(accounts.accounts(for: .github).isEmpty ? "연결" : "계정 추가") { connectGitHub() }
                        .disabled(githubToken.trimmed.isEmpty || working != nil)
                    if accounts.ghPath != nil {
                        Button("gh CLI 로그인 가져오기") { importGH() }
                            .disabled(working != nil)
                    }
                    if working == .github { ProgressView().controlSize(.small) }
                    Spacer()
                    Link("토큰 만들기", destination: URL(string: "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Branchwork")!)
                }
            } header: {
                Text("GitHub \(countText(.github))")
            } footer: {
                Text("계정을 여러 개 연결하면, 같은 서버의 저장소에서는 왼쪽 PR 목록 위에서 쓸 계정을 고를 수 있습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                ForEach(accounts.accounts(for: .gitlab)) { a in
                    ConnectedRow(account: a, showServer: true) { accounts.disconnect(a) }
                }
                TextField("서버 주소", text: $gitlabServer, prompt: Text("https://gitlab.회사.co.kr"))
                SecureField("Personal access token (api 권한)", text: $gitlabToken)
                HStack {
                    Button(accounts.accounts(for: .gitlab).isEmpty ? "연결" : "계정 추가") { connectGitLab() }
                        .disabled(gitlabServer.trimmed.isEmpty || gitlabToken.trimmed.isEmpty || working != nil)
                    if working == .gitlab { ProgressView().controlSize(.small) }
                    Spacer()
                    if !gitlabServer.trimmed.isEmpty,
                       let u = URL(string: AccountStore.normalizeServer(gitlabServer) + "/-/user_settings/personal_access_tokens?name=Branchwork&scopes=api") {
                        Link("토큰 만들기", destination: u)
                    }
                }
            } header: {
                Text("사내 GitLab (자체 호스팅) \(countText(.gitlab))")
            } footer: {
                Text("회사에서 운영하는 GitLab 서버만 연결합니다(gitlab.com 은 아직 지원하지 않음). 서버마다 여러 계정을 연결할 수 있습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }

            Section("커밋 그래프") {
                Toggle("작성자 프로필 사진 보이기", isOn: Binding(get: { AvatarStore.shared.enabled }, set: { AvatarStore.shared.enabled = $0 }))
                HStack {
                    Text("GitHub 프로필 → 연결한 사내 GitLab 프로필 → Gravatar 순으로 찾고, 없으면 이니셜을 씁니다. Gravatar 에는 이메일 해시가 전송됩니다.")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("다시 받기") { AvatarStore.shared.refresh() }.controlSize(.small)
                }
            }

            Section {
                Text("토큰은 macOS 키체인에 계정별로 저장되고 PR·MR 조회와 생성, 저장소 목록, HTTPS push·pull 인증에 쓰입니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear {
            if gitlabServer.isEmpty { gitlabServer = accounts.suggestedGitLabServer }
        }
    }

    private func countText(_ p: Provider) -> String {
        let n = accounts.accounts(for: p).count
        return n == 0 ? "" : "· \(n)개"
    }

    private func connectGitHub() {
        run(.github) {
            try await accounts.connectGitHub(token: githubToken)
            githubToken = ""
        }
    }

    private func connectGitLab() {
        run(.gitlab) {
            try await accounts.connectGitLab(server: gitlabServer, token: gitlabToken)
            gitlabToken = ""
        }
    }

    private func importGH() {
        run(.github) { try await accounts.importGitHubCLI() }
    }

    private func run(_ p: Provider, _ work: @escaping @MainActor () async throws -> Void) {
        working = p
        error = nil
        Task {
            do { try await work() } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            working = nil
        }
    }
}

private struct ConnectedRow: View {
    let account: HostAccount
    var showServer = false
    let disconnect: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: account.avatarURL.flatMap(URL.init(string:))) { image in
                image.resizable()
            } placeholder: {
                Avatar(name: account.name ?? account.username, email: account.username, size: 30)
            }
            .frame(width: 30, height: 30)
            .clipShape(Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(account.name ?? account.username).fontWeight(.medium)
                Text("@\(account.username)" + (showServer ? " · \(account.host)" : "")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Label("연결됨", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption)
            Button("연결 해제", action: disconnect)
        }
    }
}
