import SwiftUI
import AppKit

/// ⌘, 설정: 계정(GitHub·GitLab), AI, 도구(실행 파일 위치)
struct SettingsView: View {
    var body: some View {
        TabView {
            AccountsSettings()
                .tabItem { Label("계정", systemImage: "person.crop.circle") }
            AISettings()
                .tabItem { Label("AI", systemImage: "sparkles") }
            RulesSettings()
                .tabItem { Label("규칙", systemImage: "text.badge.checkmark") }
            ToolsSettings()
                .tabItem { Label("도구", systemImage: "wrench.and.screwdriver") }
        }
        .frame(width: 600, height: 560)
    }
}

private struct AccountsSettings: View {
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

private struct AISettings: View {
    private let ai = AIStore.shared
    private let tools = ToolStore.shared
    @ViewState private var selected: AIProvider = AIStore.shared.provider
    @ViewState private var key = ""
    @ViewState private var models: [String] = []
    @ViewState private var listing = false
    @ViewState private var testing = false
    @ViewState private var result: String?
    @ViewState private var error: String?

    var body: some View {
        Form {
            Section("커밋 메시지·커밋 설명·PR 본문을 쓸 AI") {
                Picker("", selection: $selected) {
                    ForEach(AIProvider.allCases) { p in
                        HStack {
                            Text(p.title)
                            if ai.provider == p {
                                Text("사용 중").font(.caption2.weight(.semibold)).foregroundStyle(Color.accentColor)
                            } else if ai.problem(p) == nil {
                                Text("준비됨").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .tag(p)
                    }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
            }

            Section {
                if let tool = selected.tool {
                    LabeledContent("실행 파일") {
                        if let p = tools.path(tool) {
                            Text(p).lineLimit(1).truncationMode(.head)
                        } else {
                            Text("찾지 못함 — 도구 탭에서 불러오세요").foregroundStyle(.red)
                        }
                    }
                }
                if selected == .compatible {
                    TextField("서버 주소", text: Binding(get: { ai.baseURL }, set: { ai.setBaseURL($0) }),
                              prompt: Text("http://localhost:11434/v1"))
                }
                if !selected.isCLI {
                    if ai.hasKey[selected.rawValue] == true {
                        HStack {
                            Label("API 키 저장됨", systemImage: "key.fill")
                            Spacer()
                            Button("삭제") { ai.setKey(selected, "") }
                        }
                    } else {
                        HStack {
                            SecureField("API 키", text: $key, prompt: Text(selected.keyHint))
                            Button("저장") { ai.setKey(selected, key); key = "" }
                                .disabled(key.trimmed.isEmpty)
                        }
                    }
                }
                HStack {
                    TextField("모델", text: Binding(get: { ai.model(selected) }, set: { ai.setModel(selected, $0) }),
                              prompt: Text(selected.modelHint))
                    if !models.isEmpty {
                        Menu("목록") {
                            ForEach(models, id: \.self) { m in Button(m) { ai.setModel(selected, m) } }
                        }
                        .fixedSize()
                    }
                    if !selected.isCLI {
                        Button { fetchModels() } label: {
                            if listing { ProgressView().controlSize(.small) } else { Text("목록 불러오기") }
                        }
                        .disabled(listing)
                    }
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
                Text(selected.note).font(.caption).foregroundStyle(.secondary)
                HStack {
                    if let u = selected.keyURL.flatMap(URL.init(string:)) { Link("키 만들기", destination: u) }
                    Spacer()
                    if testing { ProgressView().controlSize(.small) }
                    Button("연결 테스트") { test() }.disabled(testing)
                    if ai.provider != selected {
                        Button("이 AI 쓰기") { ai.provider = selected }
                            .buttonStyle(.borderedProminent)
                    }
                }
                if let result { Text(result).font(.caption).lineLimit(3) }
            } header: {
                Text(selected.title)
            } footer: {
                Text("고른 AI 로 변경 내용(diff)이 전송됩니다. 키는 macOS 키체인에 저장됩니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: selected) { _, _ in
            models = []; result = nil; error = nil; key = ""
        }
    }

    private func fetchModels() {
        listing = true
        error = nil
        let p = selected
        Task {
            do {
                models = try await ai.listModels(p)
                if models.isEmpty { error = "받은 모델이 없습니다." }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            listing = false
        }
    }

    private func test() {
        testing = true
        result = nil
        let p = selected
        Task {
            do {
                let r = try await ai.complete(system: "Reply with exactly: OK", prompt: "ping", effort: "low", using: p)
                result = "✅ 응답: \(r.prefix(40))"
            } catch {
                result = "❌ " + ((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            }
            testing = false
        }
    }
}

/// 실행 파일 위치: 자동으로 못 찾으면 직접 불러온다
private struct ToolsSettings: View {
    private let tools = ToolStore.shared
    @ViewState private var error: String?
    @ViewState private var busy: ToolID?

    var body: some View {
        Form {
            Section {
                Text("사람마다 설치 위치가 달라 자동으로 못 찾으면 **불러오기**로 실행 파일을 직접 고르세요. 고른 경로는 저장되어 다음에도 그대로 씁니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(ToolID.allCases) { id in
                let st = tools.state(id)
                Section {
                    HStack {
                        Text(st.path ?? "—")
                            .font(.system(.callout, design: .monospaced))
                            .lineLimit(1).truncationMode(.head)
                            .textSelection(.enabled)
                        Spacer()
                        if busy == id { ProgressView().controlSize(.small) }
                        Button("불러오기…") { choose(id) }
                        if st.source == .custom {
                            Button("자동") { tools.resetToAuto(id) }
                                .help("직접 고른 경로를 지우고 다시 자동으로 찾습니다")
                        }
                        if st.source == .none, let u = id.install.flatMap(URL.init(string:)) {
                            Link("설치", destination: u)
                        }
                    }
                    if let v = st.version { Text(v).font(.caption).foregroundStyle(.secondary) }
                } header: {
                    HStack {
                        Text(id.title)
                        if id == .git { Text("필수").font(.caption2).foregroundStyle(.secondary) }
                        Spacer()
                        switch st.source {
                        case .custom: Text("직접 지정").font(.caption).foregroundStyle(Color.accentColor)
                        case .auto: Text("자동으로 찾음").font(.caption).foregroundStyle(.secondary)
                        case .none: Text("없음").font(.caption).foregroundStyle(.orange)
                        }
                    }
                } footer: {
                    Text(id.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }
        }
        .formStyle(.grouped)
    }

    private func choose(_ id: ToolID) {
        let p = NSOpenPanel()
        p.canChooseFiles = true
        p.canChooseDirectories = false
        p.allowsMultipleSelection = false
        p.treatsFilePackagesAsDirectories = true
        p.showsHiddenFiles = true
        p.prompt = "불러오기"
        p.message = "\(id.title) 실행 파일을 고르세요"
        if let cur = tools.path(id) { p.directoryURL = URL(fileURLWithPath: (cur as NSString).deletingLastPathComponent) }
        guard p.runModal() == .OK, let u = p.url else { return }
        error = nil
        busy = id
        Task {
            do { try await tools.setCustom(id, path: u.path) } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            busy = nil
        }
    }
}

/// AI 규칙: 공통 규칙 + 기능별 규칙(커밋 메시지·커밋 설명·PR), 기능마다 쓸 AI
private struct RulesSettings: View {
    private let ai = AIStore.shared

    var body: some View {
        Form {
            Section {
                Text("AI 가 글을 쓸 때 지킬 규칙을 적으세요. 예: prefix 는 Feature, Fix, Hotfix 중 하나. 버튼을 누르면 자주 쓰는 규칙이 한 줄 추가됩니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(InstructionKey.allCases) { key in
                Section {
                    if let f = key.feature {
                        Picker("쓸 AI", selection: Binding(get: { ai.featureProvider[f.rawValue] ?? "" },
                                                          set: { ai.setFeatureProvider(f, AIProvider(rawValue: $0)) })) {
                            Text("기본 AI (\(ai.provider.title.components(separatedBy: " (").first ?? ""))").tag("")
                            ForEach(AIProvider.allCases) { p in
                                Text((p.title.components(separatedBy: " (").first ?? p.title) + (ai.problem(p) == nil ? "" : " — 준비 안 됨")).tag(p.rawValue)
                            }
                        }
                    }
                    ChipFlow(chips: key.chips) { add($0, to: key) }
                    TextEditor(text: Binding(get: { ai.instruction(key) }, set: { ai.setInstruction(key, $0) }))
                        .font(.callout)
                        .frame(height: 84)
                        .scrollContentBackground(.hidden)
                        .padding(4)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.25)))
                } header: {
                    Text(key.title)
                } footer: {
                    Text(key.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private func add(_ chip: String, to key: InstructionKey) {
        var base = ai.instruction(key)
        while base.last?.isWhitespace == true { base.removeLast() }
        let n = base.split(separator: "\n").filter { !String($0).trimmed.isEmpty }.count
        let numbered = base.range(of: "^\\s*1[.)]", options: .regularExpression) != nil
        ai.setInstruction(key, (base.isEmpty ? "" : base + "\n") + (numbered ? "\(n + 1). " : "") + chip)
    }
}

/// 줄바꿈되는 작은 버튼들
private struct ChipFlow: View {
    let chips: [String]
    let action: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(chips, id: \.self) { c in
                Button { action(c) } label: {
                    Text("+ " + c).font(.caption)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Color.secondary.opacity(0.14)))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 400
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += row + spacing; row = 0 }
            x += s.width + spacing
            row = max(row, s.height)
        }
        return CGSize(width: width, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}
