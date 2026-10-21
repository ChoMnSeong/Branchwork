import SwiftUI
import AppKit

// MARK: - 사이드바: CI/CD

/// GitLab 파이프라인·GitHub Actions 실행 목록. 수동 작업 ▶ 실행, 다시 실행, 취소, 배포 승인.
struct CIPanel: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.openSettings) private var openSettings
    @ViewState private var expanded: Set<Int> = []

    var body: some View {
        if let target = store.target {
            VStack(spacing: 0) {
                header(target)
                Divider()
                list(target)
            }
            .task(id: "\(target.host)/\(target.path)/\(store.ciCurrentBranchOnly)") { await poll() }
            .onChange(of: AccountStore.shared.revision) { _, _ in Task { await store.loadCI() } }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "bolt.horizontal.circle").font(.largeTitle).foregroundStyle(.tertiary)
                Text("GitHub·GitLab 원격이 있는 저장소에서 파이프라인을 보고 실행할 수 있습니다.")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// 처음 읽고, 실행 중인 게 있으면 8초·없으면 45초마다 새로 고친다(펼친 파이프라인의 작업도)
    private func poll() async {
        await store.loadCI()
        while !Task.isCancelled {
            let active = store.ciPipelines.contains { $0.status.isActive }
            try? await Task.sleep(for: .seconds(active ? 8 : 45))
            if Task.isCancelled { break }
            await store.loadCI(silent: true)
            for p in store.ciPipelines where expanded.contains(p.id) && (p.status.isActive || store.ciJobs[p.id] == nil) {
                await store.loadJobs(p, silent: true)
            }
        }
    }

    private func header(_ target: RepoTarget) -> some View {
        HStack(spacing: 8) {
            Text(target.provider == .gitlab ? "파이프라인" : "Actions")
                .font(.subheadline.weight(.semibold))
            if store.ciState == .loading { ProgressView().controlSize(.mini) }
            Spacer()
            Button { store.ciCurrentBranchOnly.toggle() } label: {
                Image(systemName: store.ciCurrentBranchOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            }
            .buttonStyle(.borderless)
            .help(store.ciCurrentBranchOnly ? "모든 브랜치 보기" : "현재 브랜치(\(store.ciCurrentRef ?? "-"))만 보기")
            Button { Task { await store.loadCI() } } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless)
                .help("새로 고침")
            Button { store.sheet = .runPipeline } label: { Image(systemName: "play.circle") }
                .buttonStyle(.borderless)
                .disabled(store.ciAccess == nil || store.ciBusy.contains("run"))
                .help(target.provider == .gitlab ? "새 파이프라인 실행(브랜치·변수)" : "워크플로 실행(Run workflow)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func list(_ target: RepoTarget) -> some View {
        switch store.ciState {
        case .needsAccount:
            VStack(alignment: .leading, spacing: 8) {
                Text("파이프라인을 보려면 \(target.provider == .gitlab ? "사내 GitLab(\(target.host))" : "GitHub") 계정을 연결하세요.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("계정 연결…") { openSettings() }.buttonStyle(.link)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case .failed(let m):
            VStack(alignment: .leading, spacing: 8) {
                Text(m).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                Button("다시 시도") { Task { await store.loadCI() } }.buttonStyle(.link)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case .loaded where store.ciPipelines.isEmpty:
            Text(store.ciCurrentBranchOnly ? "이 브랜치의 실행 기록이 없습니다." : "실행 기록이 없습니다.")
                .font(.callout).foregroundStyle(.secondary)
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            List {
                ForEach(store.ciPipelines) { p in
                    DisclosureGroup(isExpanded: expansion(p)) {
                        PipelineJobs(pipeline: p)
                    } label: {
                        PipelineRow(pipeline: p, provider: target.provider) { expanded.insert(p.id); Task { await store.loadJobs(p) } }
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    private func expansion(_ p: CIPipeline) -> Binding<Bool> {
        Binding(get: { expanded.contains(p.id) }, set: { open in
            if open {
                expanded.insert(p.id)
                Task { await store.loadJobs(p) }
            } else {
                expanded.remove(p.id)
            }
        })
    }
}

/// 파이프라인 한 줄: 상태 · 제목 · 브랜치 · 시간, 오른쪽에 취소·다시 실행
private struct PipelineRow: View {
    @Environment(RepoStore.self) private var store
    let pipeline: CIPipeline
    let provider: Provider
    let expand: () -> Void

    private var title: String {
        if !pipeline.title.isEmpty { return pipeline.title }
        if let i = store.commitIndex[pipeline.sha] { return store.entries[i].commit.subject }
        return pipeline.name.isEmpty ? String(pipeline.sha.prefix(8)) : pipeline.name
    }

    var body: some View {
        let p = pipeline
        let manual = (store.ciJobs[p.id] ?? []).filter(\.canPlay).count
        HStack(alignment: .center, spacing: 6) {
            StatusIcon(status: p.status)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).lineLimit(1)
                HStack(spacing: 4) {
                    if provider == .github, !p.name.isEmpty { Text(p.name).lineLimit(1) }
                    Text("#\(p.number)").monospacedDigit()
                    Text(p.ref).font(.caption.monospaced()).lineLimit(1)
                    if let d = p.created { Text(Fmt.short(d)).lineLimit(1) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if manual > 0 {
                Button(action: expand) {
                    HStack(spacing: 2) {
                        Image(systemName: "play.fill")
                        Text("\(manual)")
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
                }
                .buttonStyle(.borderless)
                .help("수동 실행을 기다리는 작업 \(manual)개 — 펼쳐서 실행")
            }
            if store.ciBusy.contains("pipeline:\(p.id)") {
                ProgressView().controlSize(.mini)
            } else if p.status.isActive {
                Button { store.cancelPipeline(p) } label: { Image(systemName: "stop.circle") }
                    .buttonStyle(.borderless)
                    .help("실행 취소")
            } else if p.status == .failed || p.status == .canceled {
                Button { Task { await store.retryPipeline(p, failedOnly: true) } } label: { Image(systemName: "arrow.clockwise.circle") }
                    .buttonStyle(.borderless)
                    .help(provider == .gitlab ? "실패·취소된 작업 다시 실행" : "실패한 작업만 다시 실행")
            }
        }
        .contextMenu {
            Button("브라우저에서 열기") { open(p.url) }
            Button("커밋 보기") { store.reveal(p.sha) }
            Divider()
            if p.status.isActive {
                Button("실행 취소") { store.cancelPipeline(p) }
            } else if provider == .github {
                Button("모든 작업 다시 실행") { Task { await store.retryPipeline(p, failedOnly: false) } }
                Button("실패한 작업만 다시 실행") { Task { await store.retryPipeline(p, failedOnly: true) } }
                    .disabled(p.status != .failed && p.status != .canceled)
            } else {
                Button("실패·취소된 작업 다시 실행") { Task { await store.retryPipeline(p, failedOnly: true) } }
                    .disabled(p.status != .failed && p.status != .canceled)
            }
            Divider()
            Button("링크 복사") { store.copy(p.url) }
        }
    }
}

/// 펼친 파이프라인: 배포 승인 + 단계별 작업
private struct PipelineJobs: View {
    @Environment(RepoStore.self) private var store
    let pipeline: CIPipeline

    var body: some View {
        if let jobs = store.ciJobs[pipeline.id] {
            if let deps = store.ciDeployments[pipeline.id], !deps.isEmpty {
                DeploymentApproval(pipeline: pipeline, deployments: deps)
            }
            if jobs.isEmpty {
                Text("작업 없음").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(stages(jobs), id: \.0) { stage, list in
                if !stage.isEmpty {
                    Text(stage).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                        .padding(.top, 2)
                }
                ForEach(list) { j in JobRow(job: j, pipeline: pipeline) }
            }
        } else {
            ProgressView().controlSize(.small)
        }
    }

    private func stages(_ jobs: [CIJob]) -> [(String, [CIJob])] {
        var order: [String] = []
        var map: [String: [CIJob]] = [:]
        for j in jobs {
            if map[j.stage] == nil { order.append(j.stage) }
            map[j.stage, default: []].append(j)
        }
        return order.map { ($0, map[$0]!) }
    }
}

private struct JobRow: View {
    @Environment(RepoStore.self) private var store
    let job: CIJob
    let pipeline: CIPipeline

    private var provider: Provider { store.target?.provider ?? .gitlab }

    var body: some View {
        HStack(spacing: 6) {
            StatusIcon(status: job.status, size: 11)
            Text(job.name).lineLimit(1).truncationMode(.middle)
            if job.allowFailure, job.status == .failed {
                Image(systemName: "exclamationmark.triangle").font(.caption2).foregroundStyle(.orange).help("실패해도 되는 작업")
            }
            Spacer(minLength: 0)
            if let d = job.duration, d > 0 {
                Text(duration(d)).font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
            actions
        }
        .font(.callout)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open(job.url) }
        .contextMenu {
            Button("로그 보기(브라우저)") { open(job.url) }
            if job.canPlay, provider == .gitlab { Button("실행") { store.playJob(job, in: pipeline) } }
            if canRetry { Button("다시 실행") { Task { await store.retryJob(job, in: pipeline) } } }
            if job.status.isActive, provider == .gitlab { Button("취소") { Task { await store.cancelJob(job, in: pipeline) } } }
            Divider()
            Button("링크 복사") { store.copy(job.url) }
        }
        .help(job.status.title)
    }

    private var canRetry: Bool {
        switch provider {
        case .gitlab: return [.failed, .canceled, .success].contains(job.status)
        case .github: return job.status.isFinished && !pipeline.status.isActive
        }
    }

    @ViewBuilder private var actions: some View {
        if store.ciBusy.contains("job:\(job.id)") {
            ProgressView().controlSize(.mini)
        } else if job.canPlay, provider == .gitlab {
            Button { store.playJob(job, in: pipeline) } label: { Image(systemName: "play.circle.fill") }
                .buttonStyle(.borderless)
                .foregroundStyle(Color.accentColor)
                .help(job.status == .scheduled ? "지금 실행(예약 기다리지 않음)" : "수동 작업 실행")
        } else if job.status.isActive, provider == .gitlab {
            Button { Task { await store.cancelJob(job, in: pipeline) } } label: { Image(systemName: "stop.circle") }
                .buttonStyle(.borderless)
                .help("작업 취소")
        } else if canRetry, job.status != .success {
            Button { Task { await store.retryJob(job, in: pipeline) } } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless)
                .help("작업 다시 실행")
        }
    }

    private func duration(_ s: Double) -> String {
        let t = Int(s.rounded())
        return t >= 60 ? "\(t / 60)분 \(t % 60)초" : "\(t)초"
    }
}

/// GitHub 환경 보호 규칙: 배포 승인 대기
private struct DeploymentApproval: View {
    @Environment(RepoStore.self) private var store
    let pipeline: CIPipeline
    let deployments: [CIDeployment]

    var body: some View {
        let mine = deployments.filter(\.canApprove)
        VStack(alignment: .leading, spacing: 6) {
            Label("배포 승인 대기: \(deployments.map(\.environment).joined(separator: ", "))", systemImage: "hand.raised.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            if mine.isEmpty {
                Text("이 계정에는 승인 권한이 없습니다.").font(.caption).foregroundStyle(.secondary)
            } else {
                HStack {
                    Button("승인") { store.reviewDeployment(pipeline, mine, approve: true) }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                    Button("거부") { store.reviewDeployment(pipeline, mine, approve: false) }
                        .controlSize(.small)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.08)))
    }
}

private struct StatusIcon: View {
    let status: CIStatus
    var size: CGFloat = 13

    var body: some View {
        Group {
            if status == .running {
                ProgressView().controlSize(.mini).frame(width: size + 2, height: size + 2)
            } else {
                Image(systemName: status.symbol)
                    .font(.system(size: size))
                    .foregroundStyle(status.color)
                    .frame(width: size + 2, height: size + 2)
            }
        }
        .help(status.title)
    }
}

private func open(_ url: String) {
    if let u = URL(string: url) { NSWorkspace.shared.open(u) }
}

// MARK: - 실행 시트

/// GitLab: 브랜치·변수로 새 파이프라인 / GitHub: workflow_dispatch 워크플로를 브랜치·입력값으로 실행
struct RunPipelineSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @ViewState private var ref = ""
    @ViewState private var variables: [Variable] = []
    @ViewState private var workflows: [CIWorkflow] = []
    @ViewState private var workflowID: Int?
    @ViewState private var values: [String: String] = [:]
    @ViewState private var loading = false
    @ViewState private var loadError: String?

    struct Variable: Identifiable {
        let id = UUID()
        var key: String
        var value: String
        var description = ""
        var options: [String] = []
        /// .gitlab-ci.yml 에서 온 변수(이름 고정)
        var fixed = false
    }

    private var provider: Provider { store.target?.provider ?? .gitlab }
    private var workflow: CIWorkflow? { workflows.first { $0.id == workflowID } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(provider == .gitlab ? "파이프라인 실행" : "워크플로 실행").font(.title3.weight(.semibold))
            LabeledContent("브랜치") {
                let branches = store.ciBranches
                if branches.isEmpty {
                    TextField("브랜치 이름", text: $ref).textFieldStyle(.roundedBorder)
                } else {
                    Picker("", selection: $ref) {
                        ForEach(branches, id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                }
            }
            if provider == .gitlab { gitlabForm } else { githubForm }
            HStack {
                if loading { ProgressView().controlSize(.small) }
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("실행") { run() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canRun)
            }
        }
        .padding(20)
        .frame(width: 520)
        .onAppear(perform: setup)
        .onChange(of: ref) { _, _ in if provider == .github { Task { await loadWorkflows() } } }
    }

    // MARK: GitLab

    private var gitlabForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("변수").font(.subheadline.weight(.semibold))
                Spacer()
                Button { variables.append(Variable(key: "", value: "")) } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help("변수 추가")
            }
            if variables.isEmpty {
                Text("변수 없이 실행합니다.").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach($variables) { $v in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                if v.fixed {
                                    Text(v.key).font(.callout.monospaced()).frame(width: 160, alignment: .leading).lineLimit(1)
                                } else {
                                    TextField("이름", text: $v.key).textFieldStyle(.roundedBorder).font(.callout.monospaced()).frame(width: 160)
                                }
                                if v.options.isEmpty {
                                    TextField("값", text: $v.value).textFieldStyle(.roundedBorder)
                                } else {
                                    Picker("", selection: $v.value) {
                                        ForEach(v.options, id: \.self) { Text($0).tag($0) }
                                    }
                                    .labelsHidden()
                                }
                                Button { variables.removeAll { $0.id == v.id } } label: { Image(systemName: "minus.circle") }
                                    .buttonStyle(.borderless)
                                    .help("이 변수 빼기")
                            }
                            if !v.description.isEmpty {
                                Text(v.description).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .frame(maxHeight: 280)
        }
    }

    // MARK: GitHub

    @ViewBuilder private var githubForm: some View {
        if let loadError {
            Text(loadError).font(.caption).foregroundStyle(.red).textSelection(.enabled)
        } else if workflows.isEmpty {
            Text(loading ? "워크플로를 읽는 중…" : "이 브랜치에는 'Run workflow'(workflow_dispatch)가 있는 워크플로가 없습니다.")
                .font(.callout).foregroundStyle(.secondary)
        } else {
            LabeledContent("워크플로") {
                Picker("", selection: Binding(get: { workflowID ?? workflows[0].id }, set: { pick($0) })) {
                    ForEach(workflows) { w in Text(w.name).tag(w.id) }
                }
                .labelsHidden()
            }
            if let w = workflow, !w.inputs.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(w.inputs) { input in inputField(input) }
                    }
                }
                .frame(maxHeight: 320)
            }
        }
    }

    @ViewBuilder private func inputField(_ input: CIInput) -> some View {
        let binding = Binding(get: { values[input.name] ?? "" }, set: { values[input.name] = $0 })
        VStack(alignment: .leading, spacing: 3) {
            switch input.type {
            case "boolean":
                Toggle(isOn: Binding(get: { binding.wrappedValue == "true" }, set: { binding.wrappedValue = $0 ? "true" : "false" })) {
                    Text(input.description.isEmpty ? input.name : input.description)
                }
            case "choice" where !input.options.isEmpty:
                Text(label(input)).font(.callout)
                Picker("", selection: binding) {
                    ForEach(input.options, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
            default:
                Text(label(input)).font(.callout)
                TextField(input.name, text: binding).textFieldStyle(.roundedBorder)
            }
        }
    }

    private func label(_ i: CIInput) -> String {
        (i.description.isEmpty ? i.name : i.description) + (i.required ? " *" : "")
    }

    // MARK: 동작

    private var canRun: Bool {
        guard !ref.trimmed.isEmpty else { return false }
        if provider == .gitlab { return true }
        guard let w = workflow else { return false }
        return w.inputs.allSatisfy { !$0.required || !(values[$0.name] ?? "").trimmed.isEmpty || $0.type == "boolean" }
    }

    private func setup() {
        ref = store.ciBranches.first ?? store.ciCurrentRef ?? ""
        if provider == .gitlab {
            variables = store.gitlabPipelineVariables().map {
                Variable(key: $0.name, value: $0.defaultValue, description: $0.description, options: $0.options, fixed: true)
            }
        }
    }

    private func loadWorkflows() async {
        let r = ref
        guard !r.isEmpty else { return }
        loading = true
        defer { loading = false }
        do {
            let list = try await store.ciWorkflows(ref: r)
            guard r == ref else { return }
            loadError = nil
            workflows = list
            pick(list.first { $0.id == workflowID }?.id ?? list.first?.id)
        } catch {
            loadError = store.describe(error)
            workflows = []
        }
    }

    private func pick(_ id: Int?) {
        workflowID = id
        var v: [String: String] = [:]
        for i in workflows.first(where: { $0.id == id })?.inputs ?? [] {
            v[i.name] = values[i.name] ?? (i.defaultValue.isEmpty && i.type == "choice" ? i.options.first ?? "" : i.defaultValue)
            if i.type == "boolean", v[i.name] != "true" { v[i.name] = "false" }
        }
        values = v
    }

    private func run() {
        let r = ref.trimmed
        if provider == .gitlab {
            let vars = variables.map { ($0.key.trimmed, $0.value) }.filter { !$0.0.isEmpty }
            dismiss()
            Task { await store.runPipeline(ref: r, variables: vars) }
        } else if let w = workflow {
            let inputs = values.filter { k, v in !v.isEmpty && w.inputs.contains { $0.name == k } }
            dismiss()
            Task { await store.runWorkflow(w, ref: r, inputs: inputs) }
        }
    }
}
