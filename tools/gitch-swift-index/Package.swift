// swift-tools-version:5.9
// gitch-swift-index — gitch graph files 가 Swift 파일 사이 참조를 Xcode · SwiftPM 인덱스에서 정확히 읽게 하는 도우미(외부 의존 없음).
// 앱 빌드(macos/build.sh)는 SwiftPM 없이 build.sh 로 swiftc 를 바로 부른다 — 이 파일은 고칠 때 swift build · swift run 으로 쓰는 것.
import PackageDescription

let package = Package(
    name: "gitch-swift-index",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "gitch-swift-index")
    ]
)
