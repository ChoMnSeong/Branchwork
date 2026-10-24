import Foundation

/// 저장소가 추적하는 .swift 파일(git ls-files) — 인덱스에 적힌 절대 경로를 저장소 기준 경로로 바꾼다
struct Repository {
    let root: String
    /// 저장소 뿌리 기준, / 구분
    let files: [String]
    private let ids: [String: Int32]
    private let realRoot: String

    init(path: String) throws {
        // 뿌리는 git 이 아는 그대로(링크를 푼 경로) — 하위 폴더를 받아도 뿌리 기준으로 낸다
        let top = try Self.git(["rev-parse", "--show-toplevel"], in: path)
        root = String(decoding: top, as: UTF8.self).trimmingCharacters(in: .newlines)
        let list = try Self.git(["ls-files", "-z", "--", "*.swift"], in: root)
        // 충돌 중에는 같은 경로가 단계(stage)마다 한 번씩 나온다
        var files: [String] = []
        var ids: [String: Int32] = [:]
        for f in list.split(separator: 0).map({ String(decoding: $0, as: UTF8.self) }) where ids["\(root)/\(f)"] == nil {
            ids["\(root)/\(f)"] = Int32(files.count)
            files.append(f)
        }
        self.files = files
        self.ids = ids
        realRoot = Self.realPath(root) ?? root
    }

    /// 인덱스의 경로 → 파일 번호. 추적하지 않는 파일이면 nil
    func id(of path: String) -> Int32? {
        if let id = ids[path] { return id }
        // 저장소 안의 반듯한 경로인데 없으면 추적하지 않는 파일(.build/checkouts 등) — realpath 를 부르지 않는다
        if path.hasPrefix(root + "/") && !path.contains("/./") && !path.contains("/../") && !path.contains("//") { return nil }
        // 빌드가 링크를 거친 경로나 ../ 가 든 경로로 컴파일했으면 실제 경로로 한 번 더
        guard let real = Self.realPath(path), real != path else { return nil }
        if real.hasPrefix(realRoot + "/") { return ids[root + real.dropFirst(realRoot.count)] }
        return ids[real]
    }

    /// 파일을 마지막으로 고친 때(나노초). 읽지 못하면 nil
    func modificationTime(_ id: Int32) -> Int64? {
        var st = stat()
        guard stat("\(root)/\(files[Int(id)])", &st) == 0 else { return nil }
        return Int64(st.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(st.st_mtimespec.tv_nsec)
    }

    static func realPath(_ path: String) -> String? {
        guard let p = realpath(path, nil) else { return nil }
        defer { free(p) }
        return String(cString: p)
    }

    /// Process.waitUntilExit 는 런루프로 기다려 부를 때마다 0.1초 넘게 늦어서 posix_spawn 으로 바로 기다린다
    private static func git(_ args: [String], in dir: String) throws -> Data {
        var out: [Int32] = [-1, -1]
        var err: [Int32] = [-1, -1]
        guard pipe(&out) == 0 else { throw Failure(message: "git 을 실행하지 못했습니다: \(String(cString: strerror(errno)))") }
        guard pipe(&err) == 0 else {
            close(out[0])
            close(out[1])
            throw Failure(message: "git 을 실행하지 못했습니다: \(String(cString: strerror(errno)))")
        }
        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, out[1], 1)
        posix_spawn_file_actions_adddup2(&actions, err[1], 2)
        for fd in out + err { posix_spawn_file_actions_addclose(&actions, fd) }
        let argv = (["git", "-C", dir] + args).map { strdup($0) } + [nil]
        defer { argv.forEach { free($0) } }
        var pid: pid_t = 0
        let rc = posix_spawnp(&pid, "git", &actions, nil, argv, environ)
        close(out[1])
        close(err[1])
        let stdout = FileHandle(fileDescriptor: out[0], closeOnDealloc: true)
        let stderr = FileHandle(fileDescriptor: err[0], closeOnDealloc: true)
        guard rc == 0 else { throw Failure(message: "git 을 실행하지 못했습니다: \(String(cString: strerror(rc)))") }
        let data = stdout.readDataToEndOfFile()
        let message = String(decoding: stderr.readDataToEndOfFile(), as: UTF8.self)
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        guard status == 0 else {
            let first = message.split(separator: "\n").first.map(String.init) ?? "종료 코드 \(status >> 8)"
            throw Failure(message: "git \(args[0]) 실패(\(dir)): \(first)")
        }
        return data
    }
}
