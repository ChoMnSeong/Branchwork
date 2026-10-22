import SwiftUI
import AppKit

/// AI 규칙: 공통 규칙 + 기능별 규칙(커밋 메시지·커밋 설명·PR), 기능마다 쓸 AI
struct RulesSettings: View {
    private let ai = AIStore.shared

    var body: some View {
        Form {
            Section {
                Text("AI 가 글을 쓸 때 지킬 규칙을 적으세요. 예: prefix 는 Feature, Fix, Hotfix 중 하나. 버튼을 누르면 자주 쓰는 규칙이 한 줄 추가됩니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(InstructionKey.allCases) { key in
                Section {
                    if let f = key.feature {
                        Picker("쓸 AI", selection: Binding(get: { ai.featureProvider[f.rawValue] ?? "" },
                                                          set: { ai.setFeatureProvider(f, AIProvider(rawValue: $0)) })) {
                            Text("기본 AI (\(ai.provider.title.components(separatedBy: " (").first ?? ""))").tag("")
                            ForEach(AIProvider.allCases) { p in
                                Text((p.title.components(separatedBy: " (").first ?? p.title) + (ai.problem(p) == nil ? "" : " — 준비 안 됨")).tag(p.rawValue)
                            }
                        }
                    }
                    ChipFlow(chips: key.chips) { add($0, to: key) }
                    TextEditor(text: Binding(get: { ai.instruction(key) }, set: { ai.setInstruction(key, $0) }))
                        .font(.callout)
                        .frame(height: 84)
                        .scrollContentBackground(.hidden)
                        .padding(4)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.25)))
                } header: {
                    Text(key.title)
                } footer: {
                    Text(key.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private func add(_ chip: String, to key: InstructionKey) {
        var base = ai.instruction(key)
        while base.last?.isWhitespace == true { base.removeLast() }
        let n = base.split(separator: "\n").filter { !String($0).trimmed.isEmpty }.count
        let numbered = base.range(of: "^\\s*1[.)]", options: .regularExpression) != nil
        ai.setInstruction(key, (base.isEmpty ? "" : base + "\n") + (numbered ? "\(n + 1). " : "") + chip)
    }
}

/// 줄바꿈되는 작은 버튼들
private struct ChipFlow: View {
    let chips: [String]
    let action: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(chips, id: \.self) { c in
                Button { action(c) } label: {
                    Text("+ " + c).font(.caption)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Color.secondary.opacity(0.14)))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 400
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += row + spacing; row = 0 }
            x += s.width + spacing
            row = max(row, s.height)
        }
        return CGSize(width: width, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}
