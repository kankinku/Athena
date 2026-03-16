# Loop Proof

이 문서는 Athena가 실제로 `collect → compare → plan → improve → evaluate → redesign → repeat` 루프를 반복한다는 증거를 생성하고 기록하기 위한 구조다.

선행 조건: P0(iteration cascading) 코드 구현 완료 — `cascadeIteration()`, `IterationCycleRecord`, `athena research iterations <run-id>` 뷰가 동작해야 한다.

---

## 대표 Run 구조

3건의 대표 run으로 아래 시나리오를 각각 증명한다.

| Run | 시나리오 | 목적 |
|-----|----------|------|
| Run A | Multi-Iteration | 2회 이상 반복 루프가 자동 진행됨을 증명 |
| Run B | Evidence-Grounded | 증거 수집 → proposal 선택이 claim에 기반함을 증명 |
| Run C | Failure → Redesign | 실패 평가 후 다른 시도로 재설계됨을 증명 |

---

## Run A: Multi-Iteration Improvement Loop

### 설정

```bash
athena "Benchmark the current build pipeline, find the first safe improvement, implement it, evaluate it, and iterate"
```

- 명확한 개선 목표를 제공한다
- baseline 상태가 존재해야 한다
- 최소 2회 반복을 허용하는 budget을 설정한다 (`maxIterations >= 3`)

### 수행 절차

1. `athena research runs` — run이 생성되고 `running` 상태 확인
2. 첫 proposal 생성 대기 → `athena research proposals`
3. 첫 시뮬레이션 완료 대기 → `athena research simulations`
4. decision 기록 확인 → `athena research decisions`
5. `revisit_due` 전환 확인 → `athena research workflow <run-id>`
6. `cascadeIteration` 자동 실행으로 iteration #2 시작 확인
7. `athena research iterations <run-id>` — iteration 이력 확인
8. 2회 이상 반복 후 report 생성 → `athena report <session-id>`

### 기록해야 할 증거

- [ ] run-id: ________
- [ ] session-id: ________
- [ ] iteration 횟수: ________
- [ ] iteration #1 proposal-id: ________
- [ ] iteration #1 decision: ________
- [ ] iteration #2 proposal-id: ________
- [ ] iteration #2 결과가 iteration #1 평가를 반영하는가: yes / no
- [ ] `athena research iterations <run-id>` 출력 스냅샷:
  ```
  (여기에 출력 붙여넣기)
  ```
- [ ] report의 "Iteration Cycles" 섹션 스냅샷:
  ```
  (여기에 출력 붙여넣기)
  ```

### Pass 조건

- 최소 2회 iteration이 자동 진행된다
- iteration #2가 iteration #1 평가를 반영한 흔적이 있다
- 루프가 single one-shot으로 끝나지 않는다

### 결과

- 판정: pass / fail / blocked
- 날짜: ____-__-__
- 비고: ________

---

## Run B: Evidence-Grounded Selection

### 설정

```bash
athena "Research the best approach for improving test coverage in the security module, gather evidence, and propose the strongest option"
```

- 외부 증거가 의미 있는 주제를 선택한다
- `athena research ingest <url> --type url --problem-area security` 등으로 증거를 제공한다

### 수행 절차

1. run 시작 → `athena research runs`
2. 증거 ingestion → `athena research ingest <source> --type url --problem-area <area>`
3. claim 생성 확인 → `athena research claims`
4. proposal의 claimIds 연결 확인 → `athena research proposals <id>`
5. scorecard의 evidenceStrength 확인 → `athena research scorecard <proposal-id>`
6. report에서 top_claims와 evidence_coverage_gap 확인 → `athena report <session-id>`

### 기록해야 할 증거

- [ ] run-id: ________
- [ ] ingestion source-id(들): ________
- [ ] 추출된 claim 수: ________
- [ ] proposal에 연결된 claimIds: ________
- [ ] evidenceStrength 값: ________
- [ ] `athena research proposals <id>` 출력 (evidence trace):
  ```
  (여기에 출력 붙여넣기)
  ```
- [ ] evidence_coverage_gap 값: ________
- [ ] 근거 없는 proposal이 상위에 올라왔는가: yes / no

### Pass 조건

- proposal이 linked claim에 의해 선택된다
- 근거 없는 추정성 proposal은 낮은 점수를 받는다
- evidence_coverage_gap이 정확히 보고된다

### 결과

- 판정: pass / fail / blocked
- 날짜: ____-__-__
- 비고: ________

---

## Run C: Failure → Redesign Iteration

### 설정

```bash
athena "Try optimizing the hot path in the orchestrator, test the change, and iterate if the result is negative"
```

- 실패 가능성이 높은 개선을 시도하게 한다
- 시뮬레이션이 failure 또는 mixed 결과를 낼 수 있는 목표를 설정한다

### 수행 절차

1. run 시작 및 첫 proposal 확인
2. 시뮬레이션 실행 → 결과가 failure 또는 mixed인지 확인
3. decision이 `revisit` 또는 `defer`인지 확인
4. reconsideration trigger 확인 → `athena research revisit`
5. `revisit_due` 전환 → cascadeIteration으로 다음 iteration 진입
6. 두 번째 시도가 첫 실패와 다른 접근인지 확인
7. iteration 이력 확인 → `athena research iterations <run-id>`

### 기록해야 할 증거

- [ ] run-id: ________
- [ ] iteration #1 proposal-id: ________
- [ ] iteration #1 시뮬레이션 결과(outcome): ________
- [ ] iteration #1 decision type: ________
- [ ] reconsideration trigger-id: ________
- [ ] trigger 사유: ________
- [ ] iteration #2 proposal-id: ________
- [ ] iteration #2가 iteration #1과 다른 접근인가: yes / no
- [ ] report에서 실패가 성공으로 보고되지 않는가: yes / no
- [ ] `athena research iterations <run-id>` 출력 스냅샷:
  ```
  (여기에 출력 붙여넣기)
  ```

### Pass 조건

- 실패한 결과가 명시적으로 기록된다
- 다음 시도가 실패를 반영한 재설계다
- 실패가 성공처럼 보고되지 않는다

### 결과

- 판정: pass / fail / blocked
- 날짜: ____-__-__
- 비고: ________

---

## Summary

| Run | 시나리오 | 판정 | 날짜 |
|-----|----------|------|------|
| A | Multi-Iteration | | |
| B | Evidence-Grounded | | |
| C | Failure → Redesign | | |

### 완료 조건

- 최소 3건 중 3건 pass
- Run A에서 2회 이상 자동 iteration 증거
- Run B에서 evidence → proposal 연결 증거
- Run C에서 failure → redesign 연결 증거
- 각 run의 증거가 `docs/test-scenarios.md`의 해당 시나리오 pass signal에 매핑된다
