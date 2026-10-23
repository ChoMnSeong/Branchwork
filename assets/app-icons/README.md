# 앱 아이콘

설정 > 화면 > **앱 아이콘**에서 고르는 아이콘들의 원본입니다. 기본 아이콘은 여기 없고 각 플랫폼의 앱 아이콘(`macos/Resources/AppIcon.icns`, `windows/src-tauri/icons/`)을 씁니다.

## 원본 규격

- `<id>.png` — 1024×1024, 투명 배경. id 는 영문 소문자·숫자(`shadow`, `sunset2`).
- macOS 아이콘 그리드: 가운데 824×824 본체(둥근 사각형), 둘레 100px 여백에 그림자. 기본 아이콘(`macos/Tools/makeicon.swift`)과 같은 크기로 보이게.

## 아이콘 더하기

1. `assets/app-icons/<id>.png` 를 넣는다.
2. Windows 파일 만들기: `cd windows && npm ci && node scripts/app-icons.mjs`
   → `src-tauri/icons/app/<id>.ico`(바로 가기) · `src/shared/assets/app-icons/<id>.png`(미리 보기·창 아이콘)
3. 목록에 한 줄씩:
   - 맥 `macos/Sources/App/AppIcon.swift` — `case <id>` 와 `title`
   - Windows `windows/src/shared/platform/app-icon.ts` — `appIconOptions` 에 `import` 와 항목
4. 아이콘 이름을 번역에 더한다(맥 `Localizable.strings`, Windows `locales/*.json`).
5. `cd windows && npx vitest run tests/app-icons.test.ts` — 원본·Windows 파일·두 플랫폼 목록이 맞는지 본다.

맥은 빌드할 때(`macos/build.sh`) 이 폴더의 PNG 를 앱에 넣으므로 따로 만들 파일이 없습니다.
