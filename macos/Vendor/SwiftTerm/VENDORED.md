# SwiftTerm (vendored)

- 출처: https://github.com/migueldeicaza/SwiftTerm — 태그 v1.20.0 (커밋 5d14406)
- 라이선스: MIT (같은 폴더의 LICENSE)
- Gitrochi 의 내장 터미널에 쓴다. 이 맥에서 SwiftPM 이 동작하지 않아 소스를 그대로 가져와
  `build.sh` 가 별도 모듈(libSwiftTerm.a)로 컴파일한다. iOS 전용 파일과 문서는 뺐다.
- 바꾼 곳 없음. 빌드 플러그인이 만들던 `SwiftTermBuildInfo.swift` 만 직접 추가했다.
