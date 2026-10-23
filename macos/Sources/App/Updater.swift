import SwiftUI
import AppKit
import CryptoKit
import Observation

/// 자동 업데이트(맥): GitHub Releases 의 최신 릴리스를 보고 새 버전이면 알린다.
/// 받은 zip 은 릴리스의 SHA-256 과 맞고, 같은 앱(번들 ID)이며 서명이 온전할 때만 설치한다.
@MainActor @Observable
final class UpdateCenter {
    static let shared = UpdateCenter()

    static let repo = "ChoMnSeong/Branchwork"

    struct Release: Equatable {
        let version: String
        let notes: String
        let date: String?
        let zipURL: URL
        let zipName: String
        let checksumURL: URL?
        let pageURL: URL?
    }

    enum Phase: Equatable {
        case idle, checking, available, upToDate, downloading, installing
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var latest: Release?
    private(set) var progress: Double?
    private(set) var lastChecked: Date?

    var autoCheck: Bool = UserDefaults.standard.object(forKey: "autoUpdate") as? Bool ?? true {
        didSet { UserDefaults.standard.set(autoCheck, forKey: "autoUpdate") }
    }

    static var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    private var window: NSWindow?
    private var timer: Timer?

    /// 앱을 켤 때: 자동 확인이 켜져 있으면 조용히 확인하고, 하루에 한 번 다시
    func start() {
        guard timer == nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.autoCheck else { return }
                Task { await self.check(manual: false) }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 24 * 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.autoCheck else { return }
                await self.check(manual: false)
            }
        }
    }

    /// "0.10.0" > "0.9.3"
    static func isNewer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let y = b.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    func check(manual: Bool) async {
        guard phase != .checking, phase != .downloading, phase != .installing else { return }
        phase = .checking
        do {
            // 최근 릴리스 중 맥 파일이 있는 가장 새 것(Windows 만 고친 릴리스가 'latest' 일 수 있어서)
            var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(Self.repo)/releases?per_page=20")!, timeoutInterval: 20)
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            req.setValue("Branchwork", forHTTPHeaderField: "User-Agent")
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let list = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                throw AIError.failed("GitHub", String(localized: "Couldn't get release information (\((resp as? HTTPURLResponse)?.statusCode ?? 0))."))
            }
            lastChecked = Date()
            let macReleases = list.filter { r in
                r["draft"] as? Bool != true && r["prerelease"] as? Bool != true
                    && (r["assets"] as? [[String: Any]] ?? []).contains { ($0["name"] as? String ?? "").hasSuffix("-macOS.zip") }
            }
            let version = { (r: [String: Any]) in (r["tag_name"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "vV")) }
            guard let obj = macReleases.max(by: { Self.isNewer(version($1), than: version($0)) }) else {
                latest = nil
                phase = .upToDate
                if manual { showWindow() }
                return
            }
            let tag = (obj["tag_name"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            let assets = obj["assets"] as? [[String: Any]] ?? []
            let zip = assets.first { ($0["name"] as? String ?? "").hasSuffix("-macOS.zip") }
            let sum = assets.first { ($0["name"] as? String ?? "").hasSuffix("macOS.sha256") }
            guard Self.isNewer(tag, than: Self.currentVersion),
                  let zip, let zipURL = (zip["browser_download_url"] as? String).flatMap(URL.init(string:)) else {
                latest = nil
                phase = .upToDate
                if manual { showWindow() }
                return
            }
            latest = Release(version: tag, notes: obj["body"] as? String ?? "", date: (obj["published_at"] as? String).map { String($0.prefix(10)) },
                             zipURL: zipURL, zipName: zip["name"] as? String ?? "",
                             checksumURL: (sum?["browser_download_url"] as? String).flatMap(URL.init(string:)),
                             pageURL: (obj["html_url"] as? String).flatMap(URL.init(string:)))
            phase = .available
            if manual || UserDefaults.standard.string(forKey: "skippedUpdate") != tag { showWindow() }
        } catch {
            phase = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            if manual { showWindow() }
        }
    }

    func skip() {
        if let v = latest?.version { UserDefaults.standard.set(v, forKey: "skippedUpdate") }
        closeWindow()
    }

    /// 받기 → 확인 → 바꿔 넣고 다시 시작
    func install() async {
        guard let r = latest else { return }
        phase = .downloading
        progress = 0
        do {
            let dest = Bundle.main.bundleURL
            guard FileManager.default.isWritableFile(atPath: dest.deletingLastPathComponent().path) else {
                throw AIError.failed(String(localized: "Update"), String(localized: "No permission to write to \(dest.deletingLastPathComponent().path). Download and install it from the releases page."))
            }
            let newApp = try await prepare(r, bundleID: Bundle.main.bundleIdentifier)
            phase = .installing
            try Self.replace(with: newApp, at: dest, afterPID: ProcessInfo.processInfo.processIdentifier, relaunch: true)
            NSApp.terminate(nil)
        } catch {
            phase = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            progress = nil
        }
    }

    /// 받아서 확인까지: SHA-256 이 릴리스와 같고, 같은 앱(번들 ID)이며, 서명이 온전한 새 앱의 위치
    func prepare(_ r: Release, bundleID: String?) async throws -> URL {
        let work = FileManager.default.temporaryDirectory.appendingPathComponent("branchwork-update-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        let zipFile = work.appendingPathComponent(r.zipName.isEmpty ? "update.zip" : r.zipName)
        try await download(r.zipURL, to: zipFile)
        if let cu = r.checksumURL {
            let (sumData, _) = try await URLSession.shared.data(from: cu)
            let expected = String(decoding: sumData, as: UTF8.self).split(separator: "\n")
                .first { $0.hasSuffix(r.zipName) }?.split(separator: " ").first.map(String.init)
            let actual = SHA256.hash(data: try Data(contentsOf: zipFile)).map { String(format: "%02x", $0) }.joined()
            guard let expected, expected.lowercased() == actual else {
                throw AIError.failed(String(localized: "Update"), String(localized: "The downloaded file's SHA-256 doesn't match the release. It wasn't installed."))
            }
        }
        let unzip = try await Shell.run("/usr/bin/ditto", ["-x", "-k", zipFile.path, work.path], cwd: work, timeout: 120)
        guard unzip.status == 0 else { throw AIError.failed(String(localized: "Update"), String(localized: "Couldn't extract: \(unzip.stderr)")) }
        let newApp = work.appendingPathComponent("Branchwork.app")
        guard let newID = Bundle(url: newApp)?.bundleIdentifier, newID == bundleID else {
            throw AIError.failed(String(localized: "Update"), String(localized: "The downloaded file isn't Branchwork. It wasn't installed."))
        }
        let verify = try await Shell.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path], cwd: work, timeout: 120)
        guard verify.status == 0 else { throw AIError.failed(String(localized: "Update"), String(localized: "The downloaded app's signature is invalid: \(verify.stderr)")) }
        return newApp
    }

    /// pid 가 끝나면 dest 를 newApp 으로 바꿔 넣는다(실패하면 원래 앱을 되돌림). relaunch 면 다시 연다.
    nonisolated static func replace(with newApp: URL, at dest: URL, afterPID pid: Int32, relaunch: Bool) throws {
        let script = newApp.deletingLastPathComponent().appendingPathComponent("install.sh")
        try """
        #!/bin/sh
        pid="$1"; new="$2"; dest="$3"; relaunch="$4"
        while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
        rm -rf "$dest.old"
        if mv "$dest" "$dest.old" && /usr/bin/ditto "$new" "$dest"; then rm -rf "$dest.old"; else rm -rf "$dest"; mv "$dest.old" "$dest"; fi
        /usr/bin/xattr -dr com.apple.quarantine "$dest" 2>/dev/null
        [ "$relaunch" = "1" ] && /usr/bin/open "$dest"
        exit 0
        """.write(to: script, atomically: true, encoding: .utf8)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = [script.path, String(pid), newApp.path, dest.path, relaunch ? "1" : "0"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
    }

    private func download(_ url: URL, to file: URL) async throws {
        let (bytes, resp) = try await URLSession.shared.bytes(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw AIError.failed(String(localized: "Update"), String(localized: "Couldn't download the file.")) }
        let total = resp.expectedContentLength > 0 ? Double(resp.expectedContentLength) : nil
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        var buffer = Data()
        buffer.reserveCapacity(1 << 20)
        var received = 0.0
        for try await b in bytes {
            buffer.append(b)
            if buffer.count >= 1 << 20 {
                try handle.write(contentsOf: buffer)
                received += Double(buffer.count)
                buffer.removeAll(keepingCapacity: true)
                if let total { progress = received / total }
            }
        }
        try handle.write(contentsOf: buffer)
        progress = 1
    }

    // MARK: 창

    func showWindow() {
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 300),
                         styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = String(localized: "Branchwork update")
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: UpdateView())
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        window = w
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.window = nil }
        }
    }

    func closeWindow() {
        window?.close()
        window = nil
    }
}

/// 새 버전 안내 → 받기 → 설치 → 다시 시작
struct UpdateView: View {
    private let center = UpdateCenter.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch center.phase {
            case .checking:
                HStack { ProgressView().controlSize(.small); Text("Checking for a new version…") }
            case .upToDate, .idle:
                Label("Branchwork \(UpdateCenter.currentVersion) is the latest version.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                HStack { Spacer(); Button("OK") { center.closeWindow() }.keyboardShortcut(.defaultAction) }
            case .failed(let m):
                Label("Couldn't update", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text(m).font(.callout).textSelection(.enabled)
                HStack {
                    if let u = center.latest?.pageURL { Link("Open releases page", destination: u) }
                    Spacer()
                    Button("Close") { center.closeWindow() }
                }
            case .available, .downloading, .installing:
                if let r = center.latest {
                    Text("Version \(r.version) is out").font(.title3.weight(.semibold))
                    Text(String(localized: "Current version \(UpdateCenter.currentVersion) → \(r.version)") + (r.date.map { " · \($0)" } ?? ""))
                        .font(.callout).foregroundStyle(.secondary)
                    if !r.notes.isEmpty {
                        ScrollView {
                            Text(r.notes).font(.callout).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 160)
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                    }
                    if center.phase == .available {
                        HStack {
                            Button("Skip this version") { center.skip() }
                            Spacer()
                            Button("Later") { center.closeWindow() }
                            Button("Update now") { Task { await center.install() } }
                                .keyboardShortcut(.defaultAction)
                                .buttonStyle(.borderedProminent)
                        }
                    } else {
                        ProgressView(value: center.progress ?? 0)
                        Text(center.phase == .installing ? "Installing… Branchwork restarts when done" : "Downloading…")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text("A downloaded file is installed only if its SHA-256 and signature match the release. After updating, you may be asked again for Keychain access on first launch.")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}
