# 온보딩 가이드 (Onboarding)

이 문서는 Athena 모듈 협의 시스템에 처음 참여하는 개발자와 운영자를 위한 가이드다.

---

## 시스템 이해 순서

1. **[비전 문서](./vision.md)** — 이 시스템이 무엇을 하는지
2. **[비목표](./non-goals.md)** — 하지 않는 것 명확화
3. **[현재 상태 매핑](./current-state-mapping.md)** — 기존 Athena와의 관계
4. **[모듈 오너십](./module-ownership.md)** — 어떤 모듈이 있고 누가 담당하는지
5. **[영향도 모델](./impact-model.md)** — 변경 영향 분석 방법
6. **[회의 프로토콜](./meeting-protocol.md)** — 에이전트 회의 진행 방식
7. **[상태 머신](./state-machine.md)** — change proposal 생명주기

---

## 신규 모듈 등록 절차 (Task 16.2)

새 모듈을 시스템에 등록하는 방법:

### 1단계: 모듈 분석

```
□ 모듈의 역할과 책임 정의
□ 공용 인터페이스 목록화
□ 의존하는 다른 모듈 식별
□ 위험도 레벨 결정 (low/medium/high/critical)
□ 담당 에이전트 ID 결정
□ 관련 테스트 파일 목록화
□ 적합한 merge_gate 선택
```

### 2단계: 레지스트리 등록

```yaml
# config/module-registry.yaml에 추가
- module_id: <new-module>
  display_name: "모듈 표시 이름"
  description: "모듈 역할 설명"
  owner_agent: <agent-id>
  paths:
    - src/<module>/**
  public_interfaces:
    - InterfaceName1
    - functionName()
  depends_on:
    - store           # 의존하는 모듈
  affected_tests:
    - src/<module>/*.test.ts
  risk_level: medium
  merge_gate: proposal_required
```

### 3단계: change proposal로 등록

```bash
# 레지스트리 변경을 위한 change proposal 생성
athena proposal create \
  --title "신규 모듈 <name> 레지스트리 등록" \
  --paths "config/module-registry.yaml" \
  --summary "..."

# 회의 후 승인 → 레지스트리 업데이트 적용
```

### 4단계: 검증

```bash
# 레지스트리 캐시 무효화
athena impact --invalidate-cache

# 새 모듈 포함 영향도 분석 테스트
athena impact analyze --paths "src/<module>/index.ts"
# 새 모듈이 직접 영향으로 나와야 함
```

---

## 신규 에이전트 추가 절차 (Task 16.3)

새 에이전트를 시스템에 추가하는 방법:

### 에이전트 역할 정의

```
□ 에이전트 ID (예: analytics-agent)
□ 담당 모듈 (1개 이상)
□ 에이전트의 AI 모델/공급자
□ 응답 포맷 (AgentPosition 형식 준수)
□ 타임아웃 설정
□ 자율 실행 예산
```

### 레지스트리 연결

```yaml
# config/module-registry.yaml의 해당 모듈에 owner_agent 업데이트
- module_id: analytics
  owner_agent: analytics-agent    # 신규 에이전트로 지정
```

### 에이전트 프로토콜 구현

에이전트는 다음 인터페이스를 구현해야 한다:

```typescript
interface ModuleOwnerAgent {
  // 소집 수신
  onSummon(proposal: ChangeProposal, impactLevel: ImpactLevel): Promise<void>;

  // 라운드 2: 발언 제출
  submitPosition(meetingId: string, round: 2): Promise<AgentPositionRecord>;

  // 라운드 5: 투표 제출
  submitVote(meetingId: string, round: 5): Promise<AgentVote>;

  // 실행 작업 수행
  executeTask(plan: ExecutionPlanRecord, assignment: TaskAssignment): Promise<void>;

  // 검증 참여
  runTests(requiredTests: RequiredTest[]): Promise<TestResult[]>;
}
```

---

## 개발 환경 세팅

```bash
# 1. 저장소 클론
git clone https://github.com/snoglobe/athena.git
cd athena

# 2. 의존성 설치
npm install

# 3. TypeScript 빌드
npm run build

# 4. 테스트 실행
npm run test:research
npm run test:phase5

# 5. 개발 서버
npm run dev

# 6. 영향도 그래프 확인 (신규 기능)
node -e "
const { getModuleGraph } = require('./dist/impact/graph-builder.js');
const graph = getModuleGraph();
console.log('Modules:', [...graph.modules.keys()]);
"
```

---

## 자주 묻는 질문

**Q: 내 코드 변경이 회의를 트리거하는지 어떻게 확인하나요?**
```bash
athena impact analyze --paths "<my-file>"
# meeting_required 필드가 true면 회의 필요
```

**Q: 회의 없이 빠르게 변경하려면?**
```
단일 모듈 내부 변경만 해야 합니다.
- contracts.ts, index.ts 같은 공용 인터페이스 파일은 피하세요
- 단일 모듈의 내부 구현 파일만 변경하면 회의가 생략됩니다
```

**Q: 기존 Athena 연구 기능은 계속 사용 가능한가요?**
```
예. 기존 ML 연구 기능(proposal, claim, decision)은 그대로 유지됩니다.
새 change management 시스템은 기존 시스템에 추가된 것입니다.
```

**Q: 레지스트리 파일을 직접 수정해도 되나요?**
```
아니요. config/module-registry.yaml은 change proposal을 통해서만 수정해야 합니다.
직접 수정은 impact-agent가 감지하고 경고를 발생시킵니다.
```
