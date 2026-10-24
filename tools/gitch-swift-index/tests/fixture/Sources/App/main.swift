import Geometry

let shapes: [Shape] = [Square.unit, Circle(radius: 2)]
let report = Report(total: totalArea(shapes))
print(Config.title, report.text)
