public protocol Shape {
    var area: Double { get }
}

public struct Square: Shape {
    public let side: Double
    public init(side: Double) { self.side = side }
    public var area: Double { side * side }
}
