// 맥 업데이트 서명(Ed25519). 앱은 Info.plist 의 BWUpdatePublicKey 로 릴리스 zip 의 <zip>.sig 를 확인한 뒤에만 설치한다.
//   updatesign keygen                  비밀키·공개키(base64)를 두 줄로 출력
//   updatesign sign <파일>              비밀키(환경 변수 BRANCHWORK_UPDATE_KEY)로 서명해 <파일>.sig 를 만든다
//   updatesign verify <파일> <공개키>    <파일>.sig 가 맞는지 확인(맞으면 종료 코드 0)
import CryptoKit
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "keygen":
    let key = Curve25519.Signing.PrivateKey()
    print(key.rawRepresentation.base64EncodedString())
    print(key.publicKey.rawRepresentation.base64EncodedString())
case "sign" where args.count == 2:
    let file = URL(fileURLWithPath: args[args.startIndex + 1])
    guard let secret = ProcessInfo.processInfo.environment["BRANCHWORK_UPDATE_KEY"], !secret.isEmpty else {
        fail("BRANCHWORK_UPDATE_KEY 가 없습니다.")
    }
    guard let raw = Data(base64Encoded: secret.trimmingCharacters(in: .whitespacesAndNewlines)),
          let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { fail("BRANCHWORK_UPDATE_KEY 가 올바른 비밀키가 아닙니다.") }
    guard let data = try? Data(contentsOf: file) else { fail("읽지 못했습니다: \(file.path)") }
    let signature = try key.signature(for: data)
    try Data((signature.base64EncodedString() + "\n").utf8).write(to: file.appendingPathExtension("sig"))
case "verify" where args.count == 3:
    let file = URL(fileURLWithPath: args[args.startIndex + 1])
    guard let raw = Data(base64Encoded: args[args.startIndex + 2]),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { fail("공개키가 올바르지 않습니다.") }
    guard let data = try? Data(contentsOf: file),
          let sigText = try? String(contentsOf: file.appendingPathExtension("sig"), encoding: .utf8),
          let signature = Data(base64Encoded: sigText.trimmingCharacters(in: .whitespacesAndNewlines)) else { fail("파일이나 서명을 읽지 못했습니다.") }
    guard key.isValidSignature(signature, for: data) else { fail("서명이 맞지 않습니다: \(file.lastPathComponent)") }
default:
    fail("사용법: updatesign keygen | sign <파일> | verify <파일> <공개키>")
}
