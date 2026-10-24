import Foundation

public enum Format {
    public static func round(_ value: Double) -> String {
        String(format: "%.\(Config.digits)f", value)
    }
}
