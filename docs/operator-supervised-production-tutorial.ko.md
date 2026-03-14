# Athena 운영자 감독형 프로덕션 튜토리얼

## 목적

이 문서는 Athena의 `운영자 감독형(operator-supervised)` 프로덕션 경로를 처음부터 끝까지 검증하는 방법을 설명합니다.

다음과 같은 경우에 사용합니다.

- 감독형 런타임이 정상인지 확인하고 싶을 때
- soak artifact를 생성하고 싶을 때
- 현재 프로덕션 체크리스트 결과를 읽고 싶을 때
- 결과가 `green`, `red`, `blocked` 중 무엇인지 이해하고 싶을 때
- 로드맵 `Step 9-14`를 닫기 위한 증거를 수집하고 싶을 때

이 문서는 실무용입니다. 이 저장소에서 Athena를 로컬로 실행하고 있으며, PowerShell을 사용한다고 가정합니다.

## 여기서 "완료"의 의미

운영자 감독형 로드맵에서 `100%`는 단순히 "코드가 존재한다"는 뜻이 아닙니다.

다음을 모두 만족해야 합니다.

- 감독형 기능 세트가 구현되어 있다
- 검증 명령이 통과한다
- soak artifact가 기록된다
- 체크리스트가 `green`이다
- 결과가 플레이스홀더 숫자가 아니라 실제 토폴로지 검증에 기반한다

체크리스트가 `blocked`이면 보통 환경이 덜 갖춰졌다는 뜻입니다.

체크리스트가 `red`이면 Athena가 해당 토폴로지를 실제로 실행했고, 그 과정에서 실제 실패를 발견했다는 뜻입니다.

## 사용할 파일

- `docs/operator-supervised-production-roadmap.md`
- `docs/supervised-production-checklist.md`
- `docs/supervised-production-evidence-2026-03-14.md`
- `src/research/soak-harness.ts`
- `src/cli/research.ts`

## 사전 준비

1. 의존성을 설치하고 저장소가 빌드되는지 확인합니다.
2. 일반적인 Athena 사용을 위한 provider 설정이 되어 있어야 합니다.
3. smoke 검증만 할 때는 임시로 `ANTHROPIC_API_KEY=test-key` 환경변수만 있어도 충분합니다.
4. `single_remote` 또는 `multi_host`까지 검증하려면 원격 머신을 먼저 구성해야 합니다.

## 토폴로지 규칙

Athena는 감독형 검증에서 세 가지 토폴로지를 평가합니다.

- `local_only`
- `single_remote`
- `multi_host`

각 토폴로지의 요구사항은 다음과 같습니다.

- `local_only`: 원격 머신이 없어도 됩니다
- `single_remote`: 원격 머신이 최소 `1대` 필요합니다
- `multi_host`: 원격 머신이 최소 `2대` 필요합니다

필요한 원격 머신 수를 만족하지 못하면 Athena는 해당 토폴로지를 `blocked`로 표시합니다.

## 1단계: 먼저 검증부터 실행

집중 검증 스위트를 먼저 실행합니다.

```powershell
node --import tsx --test src/security/policy.test.ts src/security/audit-store.test.ts src/cli/security.test.ts src/research/review-flow.test.ts src/research/cli-regression.test.ts src/research/soak-harness.test.ts src/store/migrations-upgrade.test.ts
```

그 다음 빌드를 실행합니다.

```powershell
npm run build
```

두 명령이 모두 성공하기 전에는 soak 단계로 넘어가지 않는 것이 맞습니다.

## 2단계: 격리된 Athena Home 준비

재현 가능한 증거 수집을 위해 깨끗한 Athena home을 사용합니다.

```powershell
New-Item -ItemType Directory -Force -Path .tmp-soak-home | Out-Null
$env:ATHENA_HOME = (Resolve-Path .tmp-soak-home).Path
$env:ANTHROPIC_API_KEY = "test-key"
```

이렇게 하면 이전 soak artifact가 재사용되는 일을 막을 수 있습니다.

## 3단계: 감독형 soak 명령 실행

soak artifact를 생성합니다.

```powershell
node --import tsx src/bootstrap.ts research soak
```

이 명령은 현재 다음을 수행합니다.

- 실제 로컬 smoke 실행을 수행합니다
- 구성된 원격 머신을 확인합니다
- `$env:ATHENA_HOME\supervised-production-soak.json`에 soak artifact를 기록합니다
- 현재 감독형 체크리스트 요약을 출력합니다

예상 출력 형태는 다음과 같습니다.

```text
artifact  <supervised-production-soak.json 경로>
generated_at  <타임스탬프>
machines  local[,remote1,...]
# Athena Supervised Production Checklist
...
```

## 4단계: 체크리스트 읽기

기록된 artifact를 기준으로 최신 체크리스트를 읽습니다.

```powershell
node --import tsx src/bootstrap.ts research checklist
```

결과 해석:

- `overall=green`: 필요한 토폴로지가 모두 실제로 검증되었고 통과했습니다
- `overall=blocked`: 현재 환경에서 일부 필수 토폴로지를 아예 검증할 수 없습니다
- `overall=red`: 토폴로지를 실제로 실행했지만 실패가 발견되었습니다

## 5단계: 출력 해석

체크리스트의 각 줄은 다음 형태를 가집니다.

```text
- <scenario>: status=<pass|fail|blocked> pass=<true|false> completion=<n> recovery=<n> rollback=<n> notes=<...>
```

각 필드의 의미:

- `status=pass`: 해당 시나리오가 기준을 만족했습니다
- `status=fail`: 시나리오를 실행했지만 기준을 만족하지 못했습니다
- `status=blocked`: 현재 환경에서는 시나리오를 실행할 수 없습니다
- `completion`: 완료된 시도 / 전체 시도
- `recovery`: 유도된 실패 대비 복구 성공 비율
- `rollback`: 유도된 실패 대비 rollback 수행 비율
- `notes`: 막힌 이유 또는 실패 이유

예시:

- `requires_remote_machines=1 configured=0`
  - 원격 머신이 없어서 `single_remote`가 막혀 있습니다
- `requires_remote_machines=2 configured=1`
  - 원격 머신이 1대뿐이라 `multi_host`가 막혀 있습니다
- `unrecoverable=1|recovery_gap`
  - 해당 시나리오는 실제로 실행되었고 복구 실패가 발견되었습니다

## 6단계: 원격 머신 구성

Athena는 원격 머신 정보를 다음 파일에서 읽습니다.

```text
$env:ATHENA_HOME\machines.json
```

JSON 구조는 `src/remote/types.ts`를 따릅니다.

```json
[
  {
    "id": "gpu-1",
    "host": "10.0.0.21",
    "port": 22,
    "username": "ubuntu",
    "authMethod": "key",
    "keyPath": "C:\\Users\\you\\.ssh\\id_ed25519"
  },
  {
    "id": "gpu-2",
    "host": "10.0.0.22",
    "port": 22,
    "username": "ubuntu",
    "authMethod": "key",
    "keyPath": "C:\\Users\\you\\.ssh\\id_ed25519"
  }
]
```

`machines.json`을 편집한 뒤에는 다음을 다시 실행합니다.

```powershell
node --import tsx src/bootstrap.ts research soak
node --import tsx src/bootstrap.ts research checklist
```

## 7단계: 무엇을 green 종료 조건으로 볼 것인가

다음을 모두 만족해야 감독형 프로덕션 경로를 닫았다고 볼 수 있습니다.

1. 집중 검증 스위트가 통과한다
2. `npm run build`가 통과한다
3. `research soak`가 artifact를 정상 기록한다
4. `research checklist`가 `overall=green`을 반환한다
5. `docs/supervised-production-checklist.md`가 최신 green 출력으로 갱신된다
6. `docs/supervised-production-evidence-*.md`에 실제 명령과 출력이 기록된다

## 8단계: 증거 문서 업데이트

의미 있는 실행 결과를 확보했다면 다음 문서에 실제 출력 결과를 반영합니다.

- `docs/supervised-production-checklist.md`
- `docs/supervised-production-evidence-2026-03-14.md` 또는 더 최신 날짜의 evidence 문서

여기서 중요한 점은, blocked나 red 결과를 손으로 "예상 green"처럼 바꿔 적으면 안 된다는 것입니다.

## 현재 알려진 상태

`2026-03-14` 기준 저장소 상태는 다음과 같습니다.

- 감독형 기능은 대부분 구현되어 있습니다
- 로컬 smoke는 통과할 수 있습니다
- 원격 토폴로지 증거는 환경에 의존합니다
- 원격 머신이 구성되지 않은 상태에서는 체크리스트가 `blocked`로 남는 것이 정상입니다

이건 코드 실패가 아니라 환경 미구성 문제입니다.

## 권장 운영 흐름

실제 검증을 할 때는 아래 순서를 그대로 쓰는 것이 가장 안전합니다.

```powershell
node --import tsx --test src/security/policy.test.ts src/security/audit-store.test.ts src/cli/security.test.ts src/research/review-flow.test.ts src/research/cli-regression.test.ts src/research/soak-harness.test.ts src/store/migrations-upgrade.test.ts
npm run build
node --import tsx src/bootstrap.ts research soak
node --import tsx src/bootstrap.ts research checklist
```

결과가 `blocked`이면 토폴로지를 먼저 채웁니다.

결과가 `red`이면 런타임 동작을 고칩니다.

결과가 `green`이면 evidence 문서를 갱신하고 남은 exit gate를 닫으면 됩니다.
