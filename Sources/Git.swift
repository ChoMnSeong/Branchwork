import Foundation

struct GitResult {
    let status: Int32
    let data: Data
    let stderr: String
    var output: String { String(decoding: data, as: UTF8.self) }
}

struct GitError: LocalizedError {
    let command: String
    let message: String

    var errorDescription: String? {
        var text = message.isEmpty ? "git \(command) 실패" : message
        let lower = message.lowercased()
        if lower.contains("terminal prompts disabled") || lower.contains("authentication failed")
            || lower.contains("permission denied (publickey)") || lower.contains("could not read username") {
            text += "\n\n인증이 필요합니다. 터미널에서 한 번 push/pull 해서 자격 증명(키체인·SSH 키)을 저장한 뒤 다시 시도하세요."
        }
        return text
    }
}

/// 시스템 git 을 서브프로세스로 실행한다. 앱은 git 의 동작을 새로 구현하지 않고 그대로 위임한다.
enum Git {
    /// 설정 > 도구에서 고른 git(없으면 자동으로 찾은 것)
    static var executable: String { ToolPaths.shared.get(.git) ?? "/usr/bin/git" }

    /// 사용자 설정이 출력 형식을 바꿔 파싱이 깨지지 않도록 고정하는 옵션
    private static let baseArgs = [
        "-c", "core.quotepath=off",
        "-c", "color.ui=false",
        "-c", "diff.noprefix=false",
        "-c", "diff.mnemonicprefix=false",
        "-c", "log.showsignature=false",
        "-c", "core.pager=cat",
    ]

    private static let environment: [String: String] = {
        var env = ProcessInfo.processInfo.environment
        env["GIT_TERMINAL_PROMPT"] = "0"   // 자격 증명 프롬프트에서 멈추지 않고 실패하게
        env["GIT_OPTIONAL_LOCKS"] = "0"    // status 가 index 를 다시 써서 파일 감시가 되먹임되지 않게
        env["GIT_EDITOR"] = "true"         // merge/revert 기본 메시지를 편집기 없이 수락
        env["GIT_PAGER"] = "cat"
        env["LC_ALL"] = "en_US.UTF-8"
        let path = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + path   // 훅·git-lfs·자격 증명 도우미
        return env
    }()

    /// 종료 코드가 ok 에 없으면 GitError 를 던진다.
    @discardableResult
    static func run(_ args: [String], in dir: URL, input: String? = nil, timeout: TimeInterval = 120,
                    ok: Set<Int32> = [0], env: [String: String] = [:]) async throws -> GitResult {
        let r = try await raw(args, in: dir, input: input, timeout: timeout, env: env)
        guard ok.contains(r.status) else {
            let msg = r.stderr.trimmed.isEmpty ? r.output.trimmed : r.stderr.trimmed
            throw GitError(command: args.first ?? "", message: msg)
        }
        return r
    }

    /// 종료 코드와 상관없이 결과를 돌려준다(프로세스를 띄우지 못했을 때만 던짐).
    static func raw(_ args: [String], in dir: URL, input: String? = nil, timeout: TimeInterval = 120,
                    env: [String: String] = [:]) async throws -> GitResult {
        try await Shell.run(executable, baseArgs + args, cwd: dir,
                            env: environment.merging(env) { _, new in new }, input: input, timeout: timeout)
    }
}

/// 외부 프로그램(git, gh, claude) 실행기
enum Shell {
    private final class Box { var data = Data() }

    static func run(_ executable: String, _ args: [String], cwd: URL, env: [String: String]? = nil,
                    input: String? = nil, timeout: TimeInterval = 120) async throws -> GitResult {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: executable)
                p.arguments = args
                p.currentDirectoryURL = cwd
                if let env { p.environment = env }
                let out = Pipe()
                let err = Pipe()
                p.standardOutput = out
                p.standardError = err
                let inPipe = input == nil ? nil : Pipe()
                p.standardInput = inPipe ?? FileHandle.nullDevice

                // stderr 를 따로 비워야 출력이 많을 때 파이프가 가득 차 멈추지 않는다
                let errBox = Box()
                let group = DispatchGroup()
                group.enter()
                DispatchQueue.global(qos: .utility).async {
                    errBox.data = err.fileHandleForReading.readDataToEndOfFile()
                    group.leave()
                }

                do {
                    try p.run()
                } catch {
                    try? err.fileHandleForWriting.close()
                    group.wait()
                    let name = (executable as NSString).lastPathComponent
                    cont.resume(throwing: GitError(command: name, message: "\(name) 을(를) 실행하지 못했습니다: \(error.localizedDescription)"))
                    return
                }
                if let inPipe, let input {
                    inPipe.fileHandleForWriting.write(Data(input.utf8))
                    try? inPipe.fileHandleForWriting.close()
                }
                let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
                let data = out.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                killer.cancel()
                group.wait()
                cont.resume(returning: GitResult(status: p.terminationStatus, data: data,
                                                 stderr: String(decoding: errBox.data, as: UTF8.self)))
            }
        }
    }
}
