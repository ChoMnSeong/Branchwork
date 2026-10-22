// SwiftPM 빌드 플러그인(SwiftTermBuildInfoPlugin)이 만들던 파일을 대신한다 — Branchwork 는 swiftc 로 직접 빌드한다.
public enum SwiftTermBuildInfo {
    public static let branch: String? = nil
    public static let tag: String? = "v1.20.0"
    public static let commit: String? = "5d14406"
    public static let hasUncommittedChanges: Bool? = false
    public static let version: String = "1.20.0"
}
