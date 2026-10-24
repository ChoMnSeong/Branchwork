// swift-tools-version:5.9
// gitch-swift-index 테스트용 예제(tests/run.sh 가 임시 폴더에 복사해 swift build 로 인덱스를 만든다)
import PackageDescription

let package = Package(
    name: "Shapes",
    targets: [
        .target(name: "Geometry"),
        .executableTarget(name: "App", dependencies: ["Geometry"]),
    ]
)
