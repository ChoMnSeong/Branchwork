import SwiftUI
import AppKit
import Darwin
import SwiftTerm

/// 그래프 아래 터미널 패널의 셸 하나. 패널을 숨겨도 셸은 계속 살아 있다.
@MainActor @Observable
final class TerminalSession: Identifiable {
    let id = UUID()
    let view: ShellView
    /// 셸의 현재 폴더(출력이 있을 때마다 확인)
    private(set) var directory: String
    /// 탭 이름: 셸이 정한 제목 > 실행 중인 프로그램 > 현재 폴더 이름
    private(set) var title: String
    private(set) var running = false
    private(set) var exitCode: Int32?
    /// 보고 있지 않을 때 새 출력이 있었는지(탭에 점 표시)
    var unseenOutput = false
    var isVisible = false

    @ObservationIgnored private var relay: Relay?
    @ObservationIgnored private var shellTitle: String?
    @ObservationIgnored private var refreshScheduled = false

    init(directory: String) {
        self.directory = directory
        self.title = URL(fileURLWithPath: directory).lastPathComponent
        view = ShellView(frame: NSRect(x: 0, y: 0, width: 640, height: 260))
        let relay = Relay(owner: self)
        self.relay = relay
        view.processDelegate = relay
        view.onOutput = { [weak self] in self?.noteOutput() }
        view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        view.optionAsMetaKey = false        // ⌥ 로 특수문자·한글 입력이 되도록
        applyColors(for: NSApp.effectiveAppearance)
    }

    func start() {
        exitCode = nil
        running = true
        let shell = ToolPaths.shared.get(.shell) ?? Self.loginShell
        view.startProcess(executable: shell, args: [], environment: Self.environment(),
                          execName: "-" + URL(fileURLWithPath: shell).lastPathComponent,
                          currentDirectory: directory)
        refreshInfo()
    }

    /// 셸과 그 안에서 돌고 있는 프로그램을 끝낸다(터미널을 닫을 때처럼 SIGHUP).
    func terminate() {
        let pid = view.process?.shellPid ?? 0
        if running, pid > 0 {
            kill(-pid, SIGHUP)
            kill(pid, SIGHUP)
        }
        if running {
            view.terminate()
            if pid > 0 { Self.reap(pid) }
        }
        running = false
    }

    /// SwiftTerm 은 직접 끝낸 셸을 거두지 않아 좀비로 남으므로 여기서 거둔다(2초 안에 안 끝나면 SIGKILL).
    nonisolated private static func reap(_ pid: pid_t) {
        DispatchQueue.global(qos: .utility).async {
            var status: Int32 = 0
            for _ in 0..<20 {
                if waitpid(pid, &status, WNOHANG) != 0 { return }
                usleep(100_000)
            }
            kill(pid, SIGKILL)
            waitpid(pid, &status, 0)
        }
    }

    func focus() {
        guard let w = view.window else { return }
        w.makeFirstResponder(view)
    }

    /// 어두운/밝은 모드에 맞춘 글자·배경색(SwiftTerm 은 색을 넣을 때 한 번만 읽는다)
    func applyColors(for appearance: NSAppearance) {
        appearance.performAsCurrentDrawingAppearance {
            view.nativeBackgroundColor = Self.background.usingColorSpace(.sRGB) ?? .textBackgroundColor
            view.nativeForegroundColor = NSColor.textColor.usingColorSpace(.sRGB) ?? .textColor
            view.caretColor = NSColor.controlAccentColor.usingColorSpace(.sRGB) ?? .controlAccentColor
            view.selectedTextBackgroundColor = NSColor.selectedTextBackgroundColor.usingColorSpace(.sRGB) ?? .selectedTextBackgroundColor
        }
    }

    static let background = NSColor(name: "terminalBackground") { a in
        a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.11, green: 0.11, blue: 0.12, alpha: 1)
            : NSColor(srgbRed: 0.99, green: 0.99, blue: 0.99, alpha: 1)
    }

    /// 실행 중인 프로그램(셸 자신이 아니면). 닫기 전에 물어볼 때 쓴다.
    var foregroundProgram: String? {
        guard running, let p = view.process, p.childfd >= 0 else { return nil }
        let pgid = tcgetpgrp(p.childfd)
        guard pgid > 0, pgid != p.shellPid else { return nil }
        return Self.processName(pgid)
    }

    // MARK: 상태 갱신

    fileprivate func setShellTitle(_ t: String) {
        shellTitle = t.trimmed.isEmpty ? nil : t.trimmed
        refreshInfo()
    }

    fileprivate func processEnded(_ code: Int32?) {
        running = false
        exitCode = code
    }

    /// 출력이 쏟아질 때마다 확인하지 않도록 0.4초에 한 번만
    private func noteOutput() {
        if !isVisible, !unseenOutput { unseenOutput = true }
        guard !refreshScheduled else { return }
        refreshScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            MainActor.assumeIsolated {
                self?.refreshScheduled = false
                self?.refreshInfo()
            }
        }
    }

    private func refreshInfo() {
        guard let p = view.process, p.shellPid > 0 else { return }
        if let cwd = Self.currentDirectory(p.shellPid), cwd != directory { directory = cwd }
        let name = shellTitle ?? foregroundProgram ?? URL(fileURLWithPath: directory).lastPathComponent
        if name != title { title = name }
    }

    // MARK: 셸·환경

    nonisolated static var loginShell: String {
        if let pw = getpwuid(getuid()), let sh = pw.pointee.pw_shell {
            let s = String(cString: sh)
            if FileManager.default.isExecutableFile(atPath: s) { return s }
        }
        return "/bin/zsh"
    }

    /// Finder 에서 띄운 앱은 환경 변수가 거의 없으므로 터미널에 필요한 것만 채운다(PATH 등은 로그인 셸이 읽는다).
    static func environment() -> [String] {
        var env = ProcessInfo.processInfo.environment
        for k in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "TERM_SESSION_ID", "__CFBundleIdentifier", "XPC_SERVICE_NAME"] {
            env.removeValue(forKey: k)
        }
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "Branchwork"
        env["TERM_PROGRAM_VERSION"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        if env["LANG"] == nil {
            env["LANG"] = Locale.current.language.languageCode?.identifier == "ko" ? "ko_KR.UTF-8" : "en_US.UTF-8"
        }
        if env["HOME"] == nil { env["HOME"] = NSHomeDirectory() }
        if env["USER"] == nil { env["USER"] = NSUserName() }
        if env["SHELL"] == nil { env["SHELL"] = loginShell }
        return env.map { "\($0.key)=\($0.value)" }
    }

    static func currentDirectory(_ pid: pid_t) -> String? {
        var info = proc_vnodepathinfo()
        let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }
        return withUnsafeBytes(of: &info.pvi_cdir.vip_path) { raw in
            let s = String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
            return s.isEmpty ? nil : s
        }
    }

    static func processName(_ pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: 256)
        guard proc_name(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
        let s = String(cString: buf)
        return s.isEmpty ? nil : s
    }
}

/// SwiftTerm 콜백(메인 큐에서 온다)을 세션으로 넘긴다
private final class Relay: NSObject, LocalProcessTerminalViewDelegate {
    weak var owner: TerminalSession?
    init(owner: TerminalSession) { self.owner = owner }

    func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

    func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        MainActor.assumeIsolated { owner?.setShellTitle(title) }
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    func processTerminated(source: TerminalView, exitCode: Int32?) {
        MainActor.assumeIsolated { owner?.processEnded(exitCode) }
    }
}

/// 출력이 올 때 알려 주는 터미널 뷰
final class ShellView: LocalProcessTerminalView {
    var onOutput: (() -> Void)?

    override func dataReceived(slice: ArraySlice<UInt8>) {
        super.dataReceived(slice: slice)
        onOutput?()
    }
}

// MARK: - 저장소 창과 연결

extension RepoStore {
    var activeTerminal: TerminalSession? {
        terminals.first { $0.id == activeTerminalID } ?? terminals.last
    }

    /// ⌃` : 터미널 패널 보이기/숨기기(처음이면 저장소 폴더에서 셸을 하나 연다)
    func toggleTerminal() {
        if showTerminal {
            showTerminal = false
        } else if terminals.isEmpty {
            newTerminal()
        } else {
            showTerminal = true
        }
    }

    func newTerminal(in path: String? = nil) {
        guard let dir = path ?? url?.path else { return }
        let s = TerminalSession(directory: dir)
        terminals.append(s)
        activeTerminalID = s.id
        showTerminal = true
        s.start()
    }

    func selectTerminal(_ s: TerminalSession) {
        activeTerminalID = s.id
        s.unseenOutput = false
    }

    /// 프로그램이 돌고 있으면 한 번 묻고 닫는다
    func requestCloseTerminal(_ s: TerminalSession) {
        if let program = s.foregroundProgram {
            confirm = ConfirmRequest(title: "터미널을 닫을까요?",
                                     message: "'\(program)'이(가) 아직 실행 중입니다. 닫으면 함께 종료됩니다.",
                                     actionTitle: "닫기") { [weak self] in self?.closeTerminal(s) }
        } else {
            closeTerminal(s)
        }
    }

    func closeTerminal(_ s: TerminalSession) {
        s.terminate()
        terminals.removeAll { $0.id == s.id }
        if activeTerminalID == s.id { activeTerminalID = terminals.last?.id }
        if terminals.isEmpty { showTerminal = false }
    }

    func closeAllTerminals() {
        terminals.forEach { $0.terminate() }
        terminals = []
        activeTerminalID = nil
        showTerminal = false
    }
}

// MARK: - 화면

/// 가운데 열: 그래프(또는 diff) 위, 터미널 패널 아래. 경계선을 끌어 높이를 바꾼다.
struct ContentColumn: View {
    @Environment(RepoStore.self) private var store
    @AppStorage("terminalHeight") private var terminalHeight = 260.0
    @ViewState private var columnHeight: CGFloat = 800

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if let source = store.diffSource {
                    DiffView(source: source)
                } else {
                    GraphView()
                }
            }
            .frame(maxHeight: .infinity)

            if store.showTerminal {
                let range = 120.0...max(120.0, Double(columnHeight) - 200)
                TerminalPanel()
                    .frame(height: min(max(terminalHeight, range.lowerBound), range.upperBound))
                    .overlay(alignment: .top) {
                        SplitHandle(height: $terminalHeight, range: range)
                    }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { columnHeight = $0 }
    }
}

/// 위아래 크기 조절 손잡이(보이는 선은 1pt, 잡는 영역은 9pt)
private struct SplitHandle: View {
    @Binding var height: Double
    let range: ClosedRange<Double>
    @ViewState private var startHeight: Double?

    var body: some View {
        Color.clear
            .frame(height: 9)
            .contentShape(Rectangle())
            .pointerStyle(.rowResize)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in
                        let start = startHeight ?? height
                        if startHeight == nil { startHeight = start }
                        height = min(max(start - v.translation.height, range.lowerBound), range.upperBound)
                    }
                    .onEnded { _ in startHeight = nil }
            )
            .offset(y: -4.5)
    }
}

struct TerminalPanel: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            header
            Divider()
            ZStack {
                Color(nsColor: TerminalSession.background)
                if let s = store.activeTerminal {
                    TerminalHost(session: s)
                        .id(s.id)
                        .padding(.leading, 8)
                        .padding(.top, 4)
                    if !s.running {
                        ended(s)
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "apple.terminal")
                .foregroundStyle(.secondary)
                .padding(.trailing, 2)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(store.terminals.enumerated()), id: \.element.id) { i, s in
                        TerminalTab(session: s, number: store.terminals.count > 1 ? i + 1 : nil,
                                    selected: s.id == store.activeTerminal?.id,
                                    select: { store.selectTerminal(s) },
                                    close: { store.requestCloseTerminal(s) })
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Button { store.newTerminal() } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .hoverTip("새 터미널", "저장소 폴더에서 셸을 하나 더 엽니다.")
            Spacer(minLength: 8)
            if let s = store.activeTerminal {
                Button { Launcher.openTerminal(at: s.directory) } label: {
                    Image(systemName: "arrow.up.forward.app")
                }
                .buttonStyle(.borderless)
                .hoverTip("Terminal 앱에서 열기", "지금 폴더(\(abbreviate(s.directory)))를 macOS Terminal 앱 새 창으로 엽니다.")
            }
            Button { store.showTerminal = false } label: {
                Image(systemName: "chevron.down")
            }
            .buttonStyle(.borderless)
            .hoverTip("터미널 숨기기", "패널만 숨기고 셸은 계속 실행됩니다.", shortcut: "⌃`")
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(.bar)
    }

    private func ended(_ s: TerminalSession) -> some View {
        VStack(spacing: 8) {
            Text(s.exitCode.map { "셸이 종료되었습니다 (코드 \($0))" } ?? "셸이 종료되었습니다")
                .foregroundStyle(.secondary)
            HStack {
                Button("다시 시작") { s.start(); s.focus() }
                    .keyboardShortcut(.defaultAction)
                Button("닫기") { store.closeTerminal(s) }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func abbreviate(_ path: String) -> String {
        let home = NSHomeDirectory()
        return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
    }
}

private struct TerminalTab: View {
    let session: TerminalSession
    /// 같은 폴더 이름의 탭을 구분하려고 여러 개일 때만 번호를 붙인다
    let number: Int?
    let selected: Bool
    let select: () -> Void
    let close: () -> Void
    @ViewState private var hovering = false

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(session.running ? (session.unseenOutput ? Color.accentColor : Color.green) : Color.secondary)
                .frame(width: 6, height: 6)
            if let number {
                Text("\(number)").foregroundStyle(.secondary).monospacedDigit()
            }
            Text(session.title)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 160, alignment: .leading)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .frame(width: 14, height: 14)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .opacity(hovering || selected ? 1 : 0)
            .help("터미널 닫기")
        }
        .font(.caption)
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 3)
        .background(selected ? Color.primary.opacity(0.1) : (hovering ? Color.primary.opacity(0.05) : .clear),
                    in: RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .help(session.directory)
    }
}

/// 세션의 터미널 뷰를 SwiftUI 안에 붙인다. 뷰는 세션이 들고 있어 탭을 바꿔도 화면과 셸이 그대로다.
private struct TerminalHost: NSViewRepresentable {
    let session: TerminalSession

    func makeNSView(context: Context) -> TerminalContainer {
        let c = TerminalContainer()
        c.attach(session)
        return c
    }

    func updateNSView(_ c: TerminalContainer, context: Context) {
        c.attach(session)
    }

    static func dismantleNSView(_ c: TerminalContainer, coordinator: ()) {
        c.session?.isVisible = false
    }
}

private final class TerminalContainer: NSView {
    private(set) weak var session: TerminalSession?

    func attach(_ s: TerminalSession) {
        if session === s, s.view.superview === self { return }
        session?.isVisible = false
        session = s
        subviews.forEach { $0.removeFromSuperview() }
        let v = s.view
        v.removeFromSuperview()
        v.translatesAutoresizingMaskIntoConstraints = false
        addSubview(v)
        NSLayoutConstraint.activate([
            v.leadingAnchor.constraint(equalTo: leadingAnchor),
            v.trailingAnchor.constraint(equalTo: trailingAnchor),
            v.topAnchor.constraint(equalTo: topAnchor),
            v.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        s.isVisible = true
        s.unseenOutput = false
        focusSoon()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { focusSoon() }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        session?.applyColors(for: effectiveAppearance)
    }

    private func focusSoon() {
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let s = self.session, let w = self.window, s.view.superview === self else { return }
                s.applyColors(for: self.effectiveAppearance)
                w.makeFirstResponder(s.view)
            }
        }
    }
}
