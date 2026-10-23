import SwiftUI

/// Shown while a repository opens or clones: the app icon's commit line grows while the Gitrochi watches it.
/// Windows draws the same picture (shared/ui/LoadingView.tsx).
struct LoadingView: View {
    let title: String
    let step: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.07, green: 0.08, blue: 0.17), Color(red: 0.03, green: 0.04, blue: 0.08)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color(red: 0.24, green: 0.35, blue: 1).opacity(0.16), .clear], center: .center, startRadius: 10, endRadius: 340)

            VStack(spacing: 22) {
                Group {
                    if reduceMotion {
                        GitrochiMark(phase: 0.6)
                    } else {
                        TimelineView(.animation) { context in
                            let t = context.date.timeIntervalSinceReferenceDate
                            GitrochiMark(phase: t.truncatingRemainder(dividingBy: GitrochiMark.period) / GitrochiMark.period)
                        }
                    }
                }
                .frame(width: 176, height: 176)

                VStack(spacing: 8) {
                    Text(title)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(step ?? " ")
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.72))
                        .id(step ?? "")
                        .transition(.opacity)
                }
                .animation(.easeInOut(duration: 0.25), value: step)
            }
            .padding(40)
        }
        .ignoresSafeArea()
    }
}

/// One frame of the mark; phase is 0…1 per loop. Coordinates are in a unit square.
struct GitrochiMark: View {
    static let period: Double = 3.2

    let phase: Double

    private static let line = Color(red: 0.92, green: 0.93, blue: 0.96)
    private static let hole = Color(red: 0.12, green: 0.13, blue: 0.2)
    private static let green = Color(red: 0.29, green: 0.87, blue: 0.5)
    private static let eye = Color(red: 0.8, green: 0.84, blue: 1)
    private static let rim = Color(red: 0.35, green: 0.47, blue: 1)

    private static let a = CGPoint(x: 0.24, y: 0.36), b = CGPoint(x: 0.40, y: 0.66), c = CGPoint(x: 0.74, y: 0.62)
    /// The commit line A → B → C, sampled into points with their distance along the line
    private static let samples: [(point: CGPoint, distance: Double)] = {
        func cubic(_ p0: CGPoint, _ p1: CGPoint, _ p2: CGPoint, _ p3: CGPoint, _ t: Double) -> CGPoint {
            let u = 1 - t
            return CGPoint(x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
                           y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y)
        }
        let bend = CGPoint(x: 0.24, y: 0.50)
        var points = (0...10).map { i in CGPoint(x: a.x, y: a.y + (bend.y - a.y) * Double(i) / 10) }
        points += (1...40).map { cubic(bend, CGPoint(x: 0.24, y: 0.61), CGPoint(x: 0.29, y: 0.66), b, Double($0) / 40) }
        points += (1...60).map { cubic(b, CGPoint(x: 0.52, y: 0.69), CGPoint(x: 0.62, y: 0.68), c, Double($0) / 60) }
        var distance = 0.0
        return points.enumerated().map { i, point in
            if i > 0 { distance += hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) }
            return (point, distance)
        }
    }()

    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width, size.height)
            func p(_ u: CGPoint) -> CGPoint { CGPoint(x: u.x * s, y: u.y * s) }
            ctx.opacity = phase < 0.08 ? phase / 0.08 : (phase > 0.86 ? max(0, (1 - phase) / 0.14) : 1)

            // The Gitrochi: a dark head with a blue rim light
            let head = Path(ellipseIn: CGRect(x: 0.44 * s, y: 0.06 * s, width: 0.5 * s, height: 0.5 * s))
            var glow = ctx
            glow.addFilter(.blur(radius: s * 0.03))
            glow.stroke(head, with: .color(Self.rim.opacity(0.55)), lineWidth: s * 0.02)
            ctx.fill(head, with: .color(Color(red: 0.06, green: 0.07, blue: 0.14)))

            // Commit line growing from A to C
            let grow = Self.ease((phase - 0.04) / 0.5)
            let total = Self.samples.last!.distance
            let shown = Self.samples.filter { $0.distance <= total * grow }
            let tip = p(shown.last?.point ?? Self.a)
            if shown.count > 1 {
                var path = Path()
                path.addLines(shown.map { p($0.point) })
                let style = StrokeStyle(lineWidth: s * 0.06, lineCap: .round, lineJoin: .round)
                glow.stroke(path, with: .color(Self.line.opacity(0.35)), style: style)
                ctx.stroke(path, with: .color(Self.line), style: style)
            }

            // Commits pop in as the line reaches them; the last one glows green
            let bAt = Self.samples.first { $0.point == Self.b }!.distance / total
            for (center, at, isLast) in [(Self.a, 0.0, false), (Self.b, bAt, false), (Self.c, 1.0, true)] {
                let appear = min(1, max(0, (grow - at) / 0.1 + (grow >= 1 && at >= 1 ? 1 : 0)))
                guard appear > 0 else { continue }
                let r = s * 0.075 * Self.easeOutBack(appear)
                let rect = CGRect(x: p(center).x - r, y: p(center).y - r, width: r * 2, height: r * 2)
                if isLast {
                    var halo = ctx
                    halo.addFilter(.blur(radius: s * 0.05))
                    halo.fill(Circle().path(in: rect.insetBy(dx: -r * 0.4, dy: -r * 0.4)), with: .color(Self.green.opacity(0.6)))
                }
                ctx.fill(Circle().path(in: rect), with: .color(isLast ? Color(red: 0.86, green: 0.98, blue: 0.9) : Self.line))
                ctx.fill(Circle().path(in: rect.insetBy(dx: r * 0.45, dy: r * 0.45)), with: .color(isLast ? Self.green : Self.hole))
            }

            // Eyes follow the tip of the line and blink once a loop
            let blink = 1 - 0.92 * max(0, 1 - abs(phase - 0.66) / 0.035)
            for (center, w, h, angle) in [(CGPoint(x: 0.58, y: 0.26), 0.1, 0.16, -0.2), (CGPoint(x: 0.80, y: 0.37), 0.16, 0.1, -0.3)] {
                let c = p(center)
                let transform = CGAffineTransform(translationX: c.x, y: c.y).rotated(by: angle).scaledBy(x: 1, y: blink)
                let eye = Path(ellipseIn: CGRect(x: -w * s / 2, y: -h * s / 2, width: w * s, height: h * s)).applying(transform)
                var eyeGlow = ctx
                eyeGlow.addFilter(.blur(radius: s * 0.025))
                eyeGlow.fill(eye, with: .color(Self.rim.opacity(0.7)))
                ctx.fill(eye, with: .color(Self.eye))
                let dx = tip.x - c.x, dy = tip.y - c.y, d = max(1, hypot(dx, dy))
                let look = CGPoint(x: c.x + dx / d * min(w, h) * s * 0.22, y: c.y + dy / d * min(w, h) * s * 0.22)
                ctx.drawLayer { layer in
                    layer.clip(to: eye)
                    let pw = min(w, h) * s * 0.32, ph = max(w, h) * s * 0.7
                    layer.fill(Path(ellipseIn: CGRect(x: look.x - pw / 2, y: look.y - ph / 2, width: pw, height: ph)),
                               with: .color(Color(red: 0.08, green: 0.09, blue: 0.24)))
                }
            }
        }
    }

    private static func ease(_ x: Double) -> Double {
        let t = min(1, max(0, x))
        return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }

    private static func easeOutBack(_ x: Double) -> Double {
        let t = min(1, max(0, x))
        let c1 = 1.70158, c3 = c1 + 1
        return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)
    }
}
