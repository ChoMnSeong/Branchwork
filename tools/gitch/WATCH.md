# 소스 변경 시 그래프 갱신

```sh
gitch g watch files
gitch g watch modules --lang java
gitch g watch precise --index index.scip
gitch g watch affected
gitch g watch files --out graph.html --no-open --detach --json
```

처음 그래프를 만든 뒤 로컬 브라우저에서 엽니다. Git이 추적하는 소스, HEAD·인덱스, 의존 규칙과 선택한 SCIP 인덱스가 바뀌면 다시 분석합니다. 감시는 변경을 모아 순서대로 처리합니다. 새 HTML이 완성되기 전에는 현재 그래프를 계속 보여 주며 분석 실패 시 이전 결과와 실패 이유를 남깁니다. 화면 아래의 실시간 갱신 버튼으로 다시 시도할 수도 있습니다.

SCIP 모드에서는 인덱스 자체를 새로 생성하지 않습니다. 소스를 수정하면 오래된 인덱스 진단이 나타날 수 있고, 언어별 인덱서로 다시 생성하면 그래프가 새 인덱스를 읽습니다. 일반 파일·모듈 분석과 마찬가지로 미추적 소스는 제외됩니다.

CLI의 언어·외부 패키지·날짜·깊이 등 선택한 분석 옵션은 다시 분석할 때도 전달됩니다. 화면의 언어·폴더 필터와 선택·배율은 그래프의 화면 저장 기능을 통해 복원됩니다. 시나리오 저장 데이터는 브라우저 저장소를 사용합니다. 서버는 저장소마다 같은 포트를 우선 사용하며 같은 출력·옵션으로 다시 열면 이미 실행 중인 서버와 URL을 재사용합니다. 다른 프로그램이나 동시에 열린 다른 감시가 그 포트를 쓰면 다음 포트로 열 수 있으므로 그 경우 브라우저 저장소가 달라질 수 있습니다(`storageStable: false`).

브라우저가 닫혀 3분 동안 상태 확인 요청이 없으면 감시와 로컬 서버를 종료합니다. 계속 열어 두어도 최대 수명은 24시간입니다. 다시 열면 새 감시를 시작합니다. Python 3.8 이상이 없으면 설치 안내와 함께 정적 그래프를 사용할 수 있습니다. 저장소를 열기만 했을 때 런타임·패키지를 내려받거나 인덱서를 실행하지 않습니다.

## 서버와 앱 계약

`gitch-graph-watch`는 앱과 독립 CLI에 함께 배포되는 Python 표준 라이브러리 도우미입니다. gitch가 초기 HTML을 만든 후 다음과 같이 호출합니다.

```sh
python3 tools/gitch/gitch-graph-watch \
  --repo /absolute/repository \
  --cli /absolute/path/gitch \
  --bash /absolute/path/bash \
  --out /absolute/path/graph.html \
  --relation files --interval 2 --serve --detach \
  --graph-arg=--lang --graph-arg=ts,python
```

`--relation`은 `files`, `modules`, `changes`, `tree`, `precise`, `affected`입니다. 초기 HTML이 있어야 합니다. `--detach`는 준비가 끝난 뒤 아래 JSON을 출력하고 호출자를 종료합니다. `--detach`가 없으면 JSON을 출력한 후 현재 프로세스에서 감시합니다.

`--bash`는 선택 사항입니다. 앱과 CLI는 현재 gitch를 실행한 Bash 경로를 전달하므로 Windows에서도 WSL의 bash 대신 Git Bash를 사용합니다. 직접 도우미를 호출할 때 생략하면 PATH에서 bash를 찾습니다.

```json
{
  "schemaVersion": 1,
  "url": "http://127.0.0.1:23456/<random-token>/graph",
  "stateUrl": "http://127.0.0.1:23456/<random-token>/state",
  "refreshUrl": "http://127.0.0.1:23456/<random-token>/refresh",
  "pid": 12345,
  "generation": 1,
  "storageStable": true
}
```

서버는 `127.0.0.1`에만 연결되고 무작위 토큰이 든 정확한 그래프·상태 URL만 제공합니다. 저장소 디렉터리, 소스 파일과 `.git`은 웹으로 제공하지 않습니다. 출력 파일을 심볼릭 링크로 바꿔도 그 대상 내용을 제공하거나 덮어쓰지 않습니다. 상태 확인에는 리다이렉트나 프록시를 사용하지 않습니다.

상태 JSON은 `schemaVersion`, `generation`, `phase`, `lastError`, `updatedAt`, `lastChangeAt`, `relation`, `pid`, `watching`, `watchKey`를 포함합니다. `phase`는 `idle`, `building`, `error` 중 하나입니다. `generation`은 유효한 새 그래프가 교체될 때만 늘어납니다. 수동 재분석은 `refreshUrl`에 `X-Gitch-Watch: 1` 헤더가 있는 빈 POST를 보냅니다. 다른 Origin의 요청은 거부합니다.

폴링 스크립트는 서버로 제공하는 HTML에만 삽입합니다. 저장한 정적 HTML은 그대로 독립적으로 열 수 있습니다. 새 결과를 표시하기 전 `window.gitchGraphView.saveLast()`가 있으면 호출하고 `gitch:before-live-reload` 이벤트를 보낸 후 새로 고칩니다.

서버 재사용 정보는 Git 작업 디렉터리의 `gitch/graph-watch/`에 권한 600의 파일로 기록하고 종료 시 지웁니다. 오래된 등록 파일은 살아 있는 동일 감시의 상태가 확인될 때만 재사용합니다. 경로나 셸 명령 문자열을 실행하지 않고 gitch에 검증한 인수 배열을 전달합니다. 출력·형식·브라우저 열기 옵션은 전달 목록에서 거부합니다.

## 검증

```sh
python3 tools/gitch/tests/test_watch.py
```

실제 HTTP 서버와 임시 Git 저장소에서 소스 수정, 새 추적 파일, 수정 시각을 보존한 변경, 규칙과 SCIP 파일 변경을 확인합니다. 실패·잘못된 HTML에서 이전 결과 보존, 변경 후 복구, 병렬 생성 방지, 수동 갱신, 토큰·Host·Origin 검사, 출력 링크 거부, 수명·유휴 종료, 같은 감시 재사용, 옵션 유지와 실제 gitch CLI의 자동 갱신을 검증합니다.
