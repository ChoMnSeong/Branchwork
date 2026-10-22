import SwiftUI
import AppKit

struct AISettings: View {
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
