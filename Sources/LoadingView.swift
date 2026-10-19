import SwiftUI

/// 저장소를 열거나 복제하는 동안 보이는 로딩 화면.
/// 앱 아이콘과 같은 세 갈래 브랜치가 아래에서 위로 자라고, 곁가지가 갈라졌다 다시 합쳐지며,
/// 선이 지나갈 때 커밋 점이 톡 튀어나온 뒤 사라지기를 반복한다.
struct LoadingView: View {
    let title: String
    let step: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.08, green: 0.10, blue: 0.24), Color(red: 0.04, green: 0.33, blue: 0.39)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color.white.opacity(0.10), .clear], center: .center, startRadius: 10, endRadius: 320)

            VStack(spacing: 26) {
                Group {
                    if reduceMotion {
                        BranchMark(phase: 0.7)
                    } else {
                        TimelineView(.animation) { context in
                            let t = context.date.timeIntervalSinceReferenceDate
                            BranchMark(phase: t.truncatingRemainder(dividingBy: BranchMark.period) / BranchMark.period)
                        }
                    }
                }
                .frame(width: 150, height: 176)

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

/// 한 프레임의 브랜치 그림. phase 는 0…1 한 바퀴.
struct BranchMark: View {
    static let period: Double = 2.6

    let phase: Double

    private static let main = Color(red: 0.24, green: 0.84, blue: 0.91)
    private static let feature = Color(red: 1.0, green: 0.54, blue: 0.24)
    private static let topic = Color(red: 0.61, green: 0.88, blue: 0.36)

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * w, y: y * h) }
            let lineWidth = min(w, h) * 0.06
            let r = min(w, h) * 0.058

            // 한 바퀴 안에서 각 선이 자라는 정도(0…1)와 끝에 다 같이 흐려지기
            let mainP = Self.ease((phase - 0.00) / 0.42)
            let featureP = Self.ease((phase - 0.18) / 0.42)
            let topicP = Self.ease((phase - 0.42) / 0.28)
            let alpha = phase < 0.05 ? phase / 0.05 : (phase > 0.86 ? max(0, (1 - phase) / 0.14) : 1)
            ctx.opacity = alpha

            // 선 모양(아래 → 위)
            var mainPath = Path()
            mainPath.move(to: p(0.30, 0.96))
            mainPath.addLine(to: p(0.30, 0.04))

            var featurePath = Path()
            featurePath.move(to: p(0.30, 0.80))
            featurePath.addCurve(to: p(0.64, 0.58), control1: p(0.30, 0.68), control2: p(0.64, 0.70))
            featurePath.addLine(to: p(0.64, 0.38))
            featurePath.addCurve(to: p(0.30, 0.16), control1: p(0.64, 0.26), control2: p(0.30, 0.28))

            var topicPath = Path()
            topicPath.move(to: p(0.64, 0.52))
            topicPath.addCurve(to: p(0.90, 0.30), control1: p(0.64, 0.40), control2: p(0.90, 0.42))
            topicPath.addLine(to: p(0.90, 0.22))

            let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
            var glow = ctx
            glow.addFilter(.blur(radius: lineWidth * 0.9))
            for (path, color, progress) in [(mainPath, Self.main, mainP), (featurePath, Self.feature, featureP), (topicPath, Self.topic, topicP)]
            where progress > 0 {
                let part = path.trimmedPath(from: 0, to: progress)
                glow.stroke(part, with: .color(color.opacity(0.55)), style: style)
                ctx.stroke(part, with: .color(color), style: style)
            }

            // 커밋 점: 선이 지나간 뒤 살짝 튀어 오르며 나타난다
            let nodes: [(CGPoint, Color, Double)] = [
                (p(0.30, 0.90), Self.main, Self.at(mainP, 0.065)),
                (p(0.30, 0.62), Self.main, Self.at(mainP, 0.37)),
                (p(0.30, 0.34), Self.main, Self.at(mainP, 0.67)),
                (p(0.30, 0.08), Self.main, Self.at(mainP, 0.96)),
                (p(0.64, 0.54), Self.feature, Self.at(featureP, 0.40)),
                (p(0.64, 0.40), Self.feature, Self.at(featureP, 0.58)),
                (p(0.90, 0.22), Self.topic, Self.at(topicP, 1.0)),
            ]
            for (center, color, appear) in nodes where appear > 0 {
                let s = Self.easeOutBack(appear)
                let rr = r * s
                let rect = CGRect(x: center.x - rr, y: center.y - rr, width: rr * 2, height: rr * 2)
                ctx.fill(Circle().path(in: rect), with: .color(Color(white: 0.97)))
                ctx.stroke(Circle().path(in: rect.insetBy(dx: lineWidth * 0.18, dy: lineWidth * 0.18)),
                           with: .color(color), lineWidth: lineWidth * 0.42)
                // 막 나타난 점은 퍼져 나가는 고리 하나
                if appear < 1 {
                    let ring = r * (1 + appear * 1.6)
                    ctx.stroke(Circle().path(in: CGRect(x: center.x - ring, y: center.y - ring, width: ring * 2, height: ring * 2)),
                               with: .color(color.opacity(0.5 * (1 - appear))), lineWidth: 1.5)
                }
            }
        }
    }

    /// 선 진행도가 at 을 지난 뒤 점이 나타나는 정도(0…1, 약 0.12 동안)
    private static func at(_ progress: Double, _ at: Double) -> Double {
        min(1, max(0, (progress - at) / 0.12 + (progress >= 1 && at >= 0.99 ? 1 : 0)))
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
