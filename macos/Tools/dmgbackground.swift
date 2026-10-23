// DMG 창 배경: 앱 아이콘의 밤 분위기(짙은 남색 · 푸른 테두리 빛)에 앱 → Applications 로 모이는 빛 줄기(끝은 아이콘의 초록 점),
// 아래에 안내 문구
//   swiftc -O dmgbackground.swift -o dmgbackground && ./dmgbackground <출력 폴더>
//   → background.png(640×440), background@2x.png(1280×880)
// 창 안쪽은 640×400 이고(Tools/makedmg.sh), 아래 40 은 제목 막대 높이가 달라도 빈 곳이 생기지 않게 남겨 둔다.
// 아이콘 자리(가운데 x 160 · 480, y 160)는 Tools/makedmg.sh 와 맞춘다.
// 아이콘 아래 이름은 Finder 가 그린다(라이트 모드면 검정). 일부러 바탕에 묻히게 두고 이름표를 깔지 않는다.
import AppKit
import CoreImage

let W: CGFloat = 640, H: CGFloat = 440
let appX: CGFloat = 160, appsX: CGFloat = 480, iconY: CGFloat = 160

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

// 아이콘에서 뽑은 색
let night = rgb(0x1C2436), deep = rgb(0x0C111C)
let rim = rgb(0x4287E8)
let silver = rgb(0xF7F8FA), leaf = rgb(0x6BE59A), cool = rgb(0x7FA4FF)
let text = rgb(0xE6EAF2), muted = rgb(0x8A93A8)

func draw(scale: CGFloat, to url: URL) throws {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    let cg = ctx.cgContext
    // Finder 처럼 왼쪽 위가 (0, 0)
    cg.translateBy(x: 0, y: H)
    cg.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)

    // 가운데에서 빠르게 옅어지고 가장자리는 부드럽게 사라지는 둥근 빛
    func glow(_ c: NSColor, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
        let a = c.alphaComponent
        NSGradient(colors: [c, c.withAlphaComponent(a * 0.35), c.withAlphaComponent(a * 0.1), c.withAlphaComponent(0)],
                   atLocations: [0, 0.35, 0.65, 1], colorSpace: .sRGB)!
            .draw(fromCenter: NSPoint(x: x, y: y), radius: 0, toCenter: NSPoint(x: x, y: y), radius: r, options: [])
    }

    // 바탕: 위는 아이콘 바탕의 남색, 아래로 갈수록 깊어지고, 위쪽에 아이콘 테두리 같은 푸른 빛이 번진다
    NSGradient(starting: night, ending: deep)!.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
    glow(rim.withAlphaComponent(0.32), 420, -40, 380)
    glow(rim.withAlphaComponent(0.12), 120, 60, 280)

    // 빛 줄기: 앱 뒤에서 가늘고 흐리게 나와 Applications 앞의 초록 빛(아이콘의 초록 점)으로 모인다.
    // 실제 빛처럼 끝으로 갈수록 굵고 밝아지고, 가운데는 하얗게 빛나며 둘레로 색이 번진다.
    // 한 겹씩 따로 그려 흐리게 퍼뜨린 뒤 더해서 얹는다(겹친 빛은 더 밝아진다).
    let y = iconY, from: CGFloat = 206, to: CGFloat = 386
    func light(blur: CGFloat, _ paint: () -> Void) {
        let layer = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: rep.pixelsWide, pixelsHigh: rep.pixelsHigh,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        layer.size = rep.size
        let lc = NSGraphicsContext(bitmapImageRep: layer)!.cgContext
        NSGraphicsContext.saveGraphicsState()
        lc.translateBy(x: 0, y: H)
        lc.scaleBy(x: 1, y: -1)
        NSGraphicsContext.current = NSGraphicsContext(cgContext: lc, flipped: true)
        paint()
        NSGraphicsContext.restoreGraphicsState()
        var image = layer.cgImage!
        if blur > 0 {
            let source = CIImage(cgImage: image)
            let blurred = source.clampedToExtent().applyingGaussianBlur(sigma: blur * scale).cropped(to: source.extent)
            image = CIContext().createCGImage(blurred, from: source.extent)!
        }
        cg.saveGState()
        // 픽셀 그대로 얹도록 뒤집은 좌표를 잠시 되돌린다
        cg.scaleBy(x: 1, y: -1)
        cg.translateBy(x: 0, y: -H)
        cg.setBlendMode(.plusLighter)
        cg.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
        cg.restoreGState()
    }
    // 끝으로 갈수록 굵어지는 줄기 모양을 꼬리 → 머리 색으로 채운다
    func streak(tail: CGFloat, head: CGFloat, _ colors: [NSColor], _ stops: [CGFloat]) {
        let p = NSBezierPath()
        p.move(to: NSPoint(x: from, y: y - tail))
        p.line(to: NSPoint(x: to, y: y - head))
        p.appendArc(withCenter: NSPoint(x: to, y: y), radius: head, startAngle: -90, endAngle: 90)
        p.line(to: NSPoint(x: from, y: y + tail))
        p.close()
        NSGradient(colors: colors, atLocations: stops, colorSpace: .sRGB)!.draw(in: p, angle: 0)
    }
    func dot(_ r: CGFloat, _ c: NSColor) {
        c.setFill()
        NSBezierPath(ovalIn: NSRect(x: to - r, y: y - r, width: r * 2, height: r * 2)).fill()
    }
    // 둘레로 번지는 옅은 빛: 줄기를 따라 푸른 기운, 끝 쪽은 초록
    light(blur: 34) {
        cool.withAlphaComponent(0.18).setFill()
        NSBezierPath(ovalIn: NSRect(x: from + 30, y: y - 10, width: to - from - 40, height: 20)).fill()
        leaf.withAlphaComponent(0.6).setFill()
        NSBezierPath(ovalIn: NSRect(x: to - 60, y: y - 16, width: 96, height: 32)).fill()
    }
    // 줄기: 넓은 번짐, 좁은 번짐, 하얀 심
    light(blur: 9) { streak(tail: 0.8, head: 3.2, [cool.withAlphaComponent(0), cool.withAlphaComponent(0.35), leaf.withAlphaComponent(0.9)], [0, 0.45, 1]) }
    light(blur: 2.5) { streak(tail: 0.6, head: 2.2, [cool.withAlphaComponent(0), silver.withAlphaComponent(0.45), leaf], [0, 0.55, 1]) }
    light(blur: 0.4) { streak(tail: 0.25, head: 1.1, [silver.withAlphaComponent(0), silver.withAlphaComponent(0.55), .white], [0, 0.6, 1]) }
    // 끝의 빛 점: 넓게 퍼지는 초록, 그 안의 밝은 초록, 하얗게 타는 가운데
    light(blur: 28) { dot(9, leaf.withAlphaComponent(0.6)) }
    light(blur: 14) { dot(7, leaf) }
    light(blur: 4) { dot(4.5, leaf) }
    light(blur: 0.8) { dot(2.4, .white) }
    // 렌즈에 맺히는 듯한 가로 빛 번짐(아주 옅게)
    light(blur: 1.2) {
        NSGradient(colors: [leaf.withAlphaComponent(0), NSColor.white.withAlphaComponent(0.5), leaf.withAlphaComponent(0)],
                   atLocations: [0, 0.5, 1], colorSpace: .sRGB)!
            .draw(in: NSBezierPath(ovalIn: NSRect(x: to - 46, y: y - 0.7, width: 92, height: 1.4)), angle: 0)
    }

    // 안내 문구: 앱 이름과 폴더 이름만 밝게
    let regular: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .regular), .foregroundColor: muted]
    let strong: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: text]
    let caption = NSMutableAttributedString()
    for (part, bold) in [("Drag ", false), ("Gitrochi", true), (" to ", false), ("Applications", true), (" to install", false)] {
        caption.append(NSAttributedString(string: part, attributes: bold ? strong : regular))
    }
    let size = caption.size()
    caption.draw(at: NSPoint(x: (W - size.width) / 2, y: 304))

    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using: .png, properties: [:])!.write(to: url)
}

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
try draw(scale: 1, to: out.appendingPathComponent("background.png"))
try draw(scale: 2, to: out.appendingPathComponent("background@2x.png"))
