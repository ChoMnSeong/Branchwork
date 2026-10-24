public struct Circle: Shape {
    public let radius: Double
    public init(radius: Double) { self.radius = radius }
    public var area: Double { 3.14159 * radius * radius }
}

public func totalArea(_ shapes: [Shape]) -> Double {
    shapes.reduce(0) { $0 + $1.area }
}
