import Foundation
import CryptoKit

/// 업데이트 zip 의 Ed25519 서명 확인. 서명 파일·공개키는 base64 (만들기: macos/Tools/updatesign.swift)
enum UpdateSignature {
    static func isValid(_ signatureFile: Data, for data: Data, publicKey: String) -> Bool {
        let text = String(decoding: signatureFile, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let signature = Data(base64Encoded: text),
              let raw = Data(base64Encoded: publicKey),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
        return key.isValidSignature(signature, for: data)
    }
}
