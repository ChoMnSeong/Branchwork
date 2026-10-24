# 클래스·함수 참조 인덱스

`gitch g --precise`는 저장소의 `.gitch/index.scip` 또는 `index.scip`를 읽고, `gitch g --index 경로`는 지정한 SCIP 바이너리 또는 SCIP JSON을 읽습니다. 파일 사이에 import가 없어도 인덱스에 기록된 클래스·함수·메서드의 실제 심볼이 일치하면 `reference` 연결이 생깁니다. 기존 import 연결과 함께 표시하며 각 연결에 출처 파일, 참조 줄, 정의 파일과 줄, 심볼, 인덱서 이름을 제공합니다.

언어를 파일 확장자로 인식하는 기능과 심볼 참조 분석은 범위가 다릅니다. SCIP 읽기는 언어와 무관하지만, 정밀도와 지원 문법은 인덱스를 만든 도구에 따릅니다. Tree-sitter의 구문 트리만으로 타입·함수 호출 대상을 확정하지 않습니다.

## 인덱스 만들기

CLI에서 생성 안내를 확인합니다.

```sh
gitch g index --language ts
gitch g index --language python
gitch g index --language java
```

이미 설치한 공식 인덱서로 프로젝트 루트에서 생성합니다. 프로젝트 의존성과 언어 도구가 준비되어 있어야 합니다. Gitrochi가 그래프를 여는 동작으로 패키지를 설치하거나 프로젝트를 빌드하지는 않습니다.

```sh
scip-typescript index
scip-typescript index --infer-tsconfig  # JavaScript
scip-python index . --project-name=my-project
scip-java index

gitch g --precise --format html
gitch g --index index.scip --json
```

- [scip-typescript](https://github.com/sourcegraph/scip-typescript): TypeScript·JavaScript. tsconfig와 프로젝트 의존성을 사용합니다.
- [scip-python](https://github.com/sourcegraph/scip-python): Python. 프로젝트의 가상환경을 활성화한 상태에서 실행합니다.
- [scip-java](https://github.com/scip-code/scip-java/blob/main/docs/getting-started.md): Java·Kotlin 등 JVM 프로젝트. Maven/Gradle 빌드를 실행하며 `clean`을 수행할 수 있습니다.
- [SCIP의 인덱서 목록](https://github.com/scip-code/scip#tools-using-scip): C/C++·Rust·Ruby·C#·Dart·PHP 등의 인덱스도 같은 형식으로 읽습니다.

## 누락·오래된 인덱스

분석 대상은 현재 Git이 추적하는 실제 파일입니다. 다음 항목은 그래프에서 제외하고 진단에 이유를 남깁니다.

- 저장소 밖의 문서, 추적하지 않는 파일, 심볼릭 링크, 정규화되지 않은 경로
- 소스 내용이 인덱스의 내장 소스와 다른 문서
- 내장 소스가 없고 현재 파일 수정 시각이 인덱스보다 새로운 문서
- 같은 심볼의 정의가 여러 위치에 있는 참조
- 정의를 찾지 못한 심볼과 별도 패키지의 외부 심볼

로컬 변수와 같은 파일 안의 참조는 파일 의존 연결을 만들지 않습니다. 같은 위치·심볼의 중복 레코드도 한 번만 셉니다. 인덱스의 `projectRoot`는 현재 저장소 또는 그 안의 하위 프로젝트를 가리켜야 합니다. 저장소를 다른 위치로 옮기거나 다른 컴퓨터에서 인덱스를 복사했다면 현재 위치에서 다시 생성합니다.

SCIP 표준에는 소스의 해시와 인덱스 생성 시각 필드가 없습니다. 인덱스에 소스가 내장되면 내용을 비교하고, 그렇지 않으면 파일 수정 시각으로 오래된 문서를 보수적으로 제외합니다. 수정 시각을 보존하거나 인덱스만 복사해 시각을 바꾸면 이 검사로 모든 변경을 알아낼 수는 없습니다. 인덱스 생성 후 소스를 수정했다면 다시 생성하는 것이 기준입니다. 근거에는 검사 방식(`freshness: content` 또는 `mtime`)도 들어갑니다.

## 런타임과 앱 포함

읽기 도우미 `gitch-scip-index`는 Python 3.8 이상 표준 라이브러리만 사용합니다. Python 패키지, protobuf 도구, Node, 네트워크 연결이 필요하지 않습니다. macOS·Windows 앱은 이 도우미를 gitch 옆에 포함합니다. 선택 기능이므로 Python이 없으면 CLI가 그 이유를 알리고 기존 파일·모듈 분석을 유지합니다. 인덱스 생성 도구와 Python 런타임을 자동으로 내려받지는 않습니다.

독립적으로 설치한 단일 파일 CLI에서는 이 저장소의 도우미를 gitch와 같은 폴더에 두거나 `GITCH_SCIP_INDEX`로 도우미 파일을 지정할 수 있습니다. 앱과 별도로 내려받는 CLI의 릴리스에는 도우미가 없는 버전이 있을 수 있으므로 누락 진단을 확인합니다.

## 도우미 계약

```sh
python3 tools/gitch/gitch-scip-index \
  --repo /absolute/repository \
  --index /absolute/repository/index.scip \
  --tracked /temporary/tracked-files.z \
  --scope src --lang ts,python \
  --covered /temporary/covered-files \
  --format records
```

`--tracked`는 `git ls-files -z`의 NUL 구분 결과입니다. NUL이 없으면 줄 구분 목록도 읽습니다. `--scope`와 `--lang`은 참조를 시작하는 문서를 제한하며, 대상 정의는 저장소 안에서 찾습니다. 저장소 하위 프로젝트의 `projectRoot`와 문서 경로도 공개 결과에는 저장소 기준 경로로 변환됩니다. 줄·열은 UI에 맞게 1부터 시작하며 열의 단위는 SCIP 문서의 `positionEncoding`을 함께 기록합니다.

`--format json`은 `schemaVersion: 1`, `producer`, `covered`, `edges`, `diagnostics`, `stats`를 반환합니다. `--format records`는 기존 CLI의 탭 구분 레코드를 반환합니다.

| 레코드 | 필드 |
|---|---|
| 파일 | `1`, id, `file`, 이름, 언어, 중괄호를 제외한 JSON 속성 |
| 연결 | `2`, 원본, 대상, `reference`, 중복 제거 후 참조 수, 빈 칸, 중괄호를 제외한 JSON 속성 |
| 진단 | `0`, `diagnostic`, JSON 객체 |
| 집계 | `0`, `precise`, JSON 객체 |
| 안내 | `0`, `note`, 한 줄 설명 |

연결의 `method`는 `scip`, `confidence`는 `indexed`입니다. `indexed`는 외부 인덱스의 심볼을 사용했다는 뜻이며 모든 인덱서가 컴파일러 수준의 정확도를 보장한다는 뜻은 아닙니다. `evidence`는 참조와 정의 위치, 심볼, 열 인코딩과 최신성 확인 방법을 포함합니다. 화면·출력 크기를 제한하기 위해 연결마다 근거는 최대 64개, 표시용 심볼 목록은 최대 5개입니다. 연결의 `weight`는 전체 개수이며 근거가 잘리면 `evidenceTruncated: true`가 들어갑니다. 진단은 300개까지 반환하며 제외한 진단 수와 원인별 전체 개수도 집계합니다. 인덱스 크기는 256 MiB까지 지원합니다.

사용 가능한 문서가 있으면 종료 코드 0, 없거나 잘못된 인덱스이면 종료 코드 3입니다. 실패해도 JSON 또는 진단 레코드를 반환합니다. 바이너리와 JSON 모두 0부터 시작하는 기존 3·4 정수 범위 및 최신 typed 범위를 읽고, typed 범위를 우선합니다. 알 수 없는 protobuf 필드는 건너뜁니다.

공식 [SCIP 스키마](https://github.com/scip-code/scip/blob/main/scip.proto)의 필드 번호·Definition/ForwardDefinition 비트·프로젝트 경로·문자 인코딩 규약을 사용해 자체 읽기 도우미를 구현했습니다. 외부 구현 소스를 복사하거나 인덱서 라이브러리를 번들하지 않습니다.

## 검증

```sh
python3 tools/gitch/tests/test_scip.py
```

테스트는 읽기 도우미와 독립된 SCIP 바이너리 작성기로 TypeScript·Python·Java의 파일 간 클래스·함수·메서드 참조를 만들고 실제 명령으로 읽습니다. packed/unpacked·typed·다중 줄 범위, UTF-16 열, 중복·로컬·동일 이름·모호한 정의, 외부·미해결 심볼, 오래된 소스, 경로와 추적 범위, 심볼릭 링크, 손상된 바이너리, JSON 호환성과 결정적인 레코드 출력을 검사합니다.
