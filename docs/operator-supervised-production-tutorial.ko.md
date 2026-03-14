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

## 인증 방식: 임시 API Key vs GPT Auth

이 튜토리얼에서 나오는 임시 API key 방식과 실제 GPT 인증 방식은 목적이 다릅니다.

구분은 이렇게 보면 됩니다.

- `임시 API key`
  - 문서에 나온 `ANTHROPIC_API_KEY=test-key` 같은 값
  - soak/checklist 같은 로컬 검증 흐름을 깨끗한 환경에서 실행할 때 쓰는 편의용 설정
  - 실제 OpenAI GPT 계정 인증을 대체하는 방식으로 보면 안 됩니다
- `GPT Auth`
  - OpenAI 계정으로 브라우저 로그인하는 방식
  - Athena의 OpenAI 런타임에서 실제 사용 경로는 이쪽입니다
  - 코드상 OpenAI provider는 OAuth 토큰 기반 인증을 사용합니다

즉, **로컬 smoke나 문서 재현에는 임시 API key가 편할 수 있지만, 실제 GPT 사용 경로를 잡으려면 OpenAI OAuth 로그인으로 가는 것이 맞습니다.**

## GPT Auth로 OpenAI 인증하기

OpenAI 계정으로 Athena를 인증하려면 다음 순서로 진행합니다.

1. OpenAI 로그인 시작

```powershell
node --import tsx src/bootstrap.ts auth login --provider openai
```

이 명령은:

- 브라우저를 열거나
- 브라우저를 열지 못하면 로그인 URL을 출력하고
- 로컬 callback 포트로 인증 완료를 기다립니다

코드 기준으로 OpenAI OAuth callback은 `localhost:1455`를 사용합니다.

2. 인증 상태 확인

```powershell
node --import tsx src/bootstrap.ts auth status
```

정상이라면 OpenAI 쪽 `authenticated`가 `true`로 보여야 합니다.

3. 프로젝트 기본 provider를 OpenAI로 맞추기

```powershell
node --import tsx src/bootstrap.ts init --provider openai --model gpt-5.4
```

이미 `athena.json`이 있다면 직접 수정해도 됩니다.

예시:

```json
{
  "provider": "openai",
  "model": "gpt-5.4",
  "metricNames": ["loss", "acc", "lr"]
}
```

4. 이후 Athena 실행

```powershell
node --import tsx src/bootstrap.ts
```

또는 원하는 CLI 흐름에 맞춰:

```powershell
node --import tsx src/bootstrap.ts research soak
node --import tsx src/bootstrap.ts research checklist
```

## 언제 어떤 방식을 써야 하나

- 문서 재현, 테스트용 smoke, 격리된 임시 home 검증
  - 임시 API key 방식이 편합니다
- 실제로 GPT 계정 인증을 붙여 OpenAI provider를 사용하고 싶을 때
  - `auth login --provider openai` 방식이 맞습니다
- 팀이나 운영 환경에서 OpenAI 쪽 실제 계정 인증 상태를 유지하고 싶을 때
  - `auth login --provider openai` 후 `auth status`로 확인하는 흐름이 안전합니다

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

## 환경변수 등록

다음은 실제로 자주 쓰는 환경변수를 등록하는 방법입니다.

중요:

- `OpenAI GPT Auth`는 환경변수로 토큰을 넣는 방식이 아니라 `auth login --provider openai`가 기본 경로입니다.
- 따라서 환경변수 등록은 주로 `ATHENA_HOME`, `ANTHROPIC_API_KEY`, `AGENTHUB_URL`, `AGENTHUB_KEY`에 대해 의미가 있습니다.

### 현재 PowerShell 세션에만 등록

```powershell
$env:ATHENA_HOME = "C:\Users\hanji\.athena"
$env:ANTHROPIC_API_KEY = "your-real-key"
$env:AGENTHUB_URL = "https://your-hub.example.com"
$env:AGENTHUB_KEY = "your-hub-key"
```

이 방식은 현재 터미널 창에서만 유효합니다.

### Windows 사용자 환경변수로 영구 등록

```powershell
[Environment]::SetEnvironmentVariable("ATHENA_HOME", "C:\Users\hanji\.athena", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "your-real-key", "User")
[Environment]::SetEnvironmentVariable("AGENTHUB_URL", "https://your-hub.example.com", "User")
[Environment]::SetEnvironmentVariable("AGENTHUB_KEY", "your-hub-key", "User")
```

등록 후에는 새 PowerShell 창을 다시 열어야 반영됩니다.

### 등록 확인

```powershell
echo $env:ATHENA_HOME
echo $env:ANTHROPIC_API_KEY
echo $env:AGENTHUB_URL
```

### 삭제

현재 세션에서 제거:

```powershell
Remove-Item Env:ATHENA_HOME
Remove-Item Env:ANTHROPIC_API_KEY
```

사용자 환경변수에서 제거:

```powershell
[Environment]::SetEnvironmentVariable("ATHENA_HOME", $null, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "User")
```

### GPT Auth와의 관계

정리하면:

- Claude 키 기반 실행이나 임시 smoke 검증은 환경변수 방식이 유용합니다.
- OpenAI GPT 계정 로그인은 환경변수 방식이 아니라 아래 명령으로 처리합니다.

```powershell
node --import tsx src/bootstrap.ts auth login --provider openai
node --import tsx src/bootstrap.ts auth status
```
