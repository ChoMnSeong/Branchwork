import Geometry

struct Report {
    let total: Area

    // Generated.swift 는 빌드 전에 만들고 추적하지 않는 파일 — 쌍에 나오면 안 된다
    var text: String { "\(Generated.banner) \(Format.round(total))" }
}
