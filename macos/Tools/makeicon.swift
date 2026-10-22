// 앱 아이콘 원본(1024px) 생성 — 남색→청록 그라디언트 위에 세 갈래 브랜치 선과 커밋 노드.
// 사용: swift Tools/makeicon.swift Resources/icon_1024.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_1024.png"
let S = 1024

guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: S, pixelsHigh: S, bitsPerSample: 8,
                                 samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                 colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let gctx = NSGraphicsContext(bitmapImageRep: rep) else { exit(1) }
NSGraphicsContext.current = gctx
let ctx = gctx.cgContext

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    NSColor(srgbRed: r, green: g, blue: b, alpha: a).cgColor
}

// 바탕: macOS 아이콘 그리드(824px 본체, 모서리 185)
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 34, color: rgb(0, 0, 0, 0.35))
ctx.addPath(shape); ctx.setFillColor(rgb(0.08, 0.1, 0.22)); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(shape); ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                      colors: [rgb(0.11, 0.13, 0.32), rgb(0.05, 0.40, 0.47)] as CFArray,
                      locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: body.minX, y: body.maxY),
                       end: CGPoint(x: body.maxX, y: body.minY), options: [])
// 은은한 위쪽 광택
let gloss = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                       colors: [rgb(1, 1, 1, 0.10), rgb(1, 1, 1, 0)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gloss, start: CGPoint(x: 512, y: body.maxY), end: CGPoint(x: 512, y: 560), options: [])

// 브랜치 선 (y 는 아래→위)
let main = rgb(0.24, 0.84, 0.91)    // 청록
let feature = rgb(1.0, 0.54, 0.24)  // 주황
let topic = rgb(0.61, 0.88, 0.36)   // 연두

func stroke(_ path: CGPath, _ color: CGColor) {
    ctx.addPath(path)
    ctx.setStrokeColor(color); ctx.setLineWidth(34); ctx.setLineCap(.round); ctx.setLineJoin(.round)
    ctx.strokePath()
}

let mainLine = CGMutablePath()
mainLine.move(to: CGPoint(x: 400, y: 236)); mainLine.addLine(to: CGPoint(x: 400, y: 800))
stroke(mainLine, main)

let featureLine = CGMutablePath()
featureLine.move(to: CGPoint(x: 400, y: 320))
featureLine.addCurve(to: CGPoint(x: 624, y: 470), control1: CGPoint(x: 400, y: 410), control2: CGPoint(x: 624, y: 380))
featureLine.addLine(to: CGPoint(x: 624, y: 640))
featureLine.addCurve(to: CGPoint(x: 400, y: 770), control1: CGPoint(x: 624, y: 720), control2: CGPoint(x: 400, y: 690))
stroke(featureLine, feature)

let topicLine = CGMutablePath()
topicLine.move(to: CGPoint(x: 624, y: 520))
topicLine.addCurve(to: CGPoint(x: 770, y: 690), control1: CGPoint(x: 624, y: 610), control2: CGPoint(x: 770, y: 600))
stroke(topicLine, topic)

// 커밋 노드
func node(_ x: CGFloat, _ y: CGFloat, _ color: CGColor) {
    let r: CGFloat = 46
    let rect = CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)
    ctx.setFillColor(rgb(0.97, 0.98, 1)); ctx.fillEllipse(in: rect)
    ctx.setStrokeColor(color); ctx.setLineWidth(22); ctx.strokeEllipse(in: rect.insetBy(dx: 2, dy: 2))
}
node(400, 280, main)
node(400, 530, main)
node(400, 800, main)
node(624, 470, feature)
node(624, 640, feature)
node(770, 690, topic)
ctx.restoreGState()

NSGraphicsContext.current = nil
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
