# Athena 비전

## 최상위 목표

> Athena의 목표는 목표 지향적 자율 개선 루프를 안정적으로 반복하는 연구 시스템이 되는 것이다.

Athena는 단발성 답변 시스템이 아니다. 목표를 받으면 스스로 자료를 수집하고, 후보를 비교하고, 다음 개선을 계획하고, 실행하고, 결과를 평가하고, 그 결과를 바탕으로 다음 개선 방향을 다시 설계하는 시스템이다.

## 시스템 정의

Athena는 `자율형 연구 시스템`이다.

핵심 루프:

1. 목표 정의
2. 관련 자료 수집
3. 후보 방법 비교
4. 다음 bounded improvement 계획
5. 개선 실행 또는 실험
6. 결과 평가
7. keep, discard, revisit, redesign
8. 반복

연구와 계획은 이 루프의 핵심 단계다. 논문, URL, 문서, 저장소 상태, 과거 실험 기록은 모두 다음 개선을 더 잘 선택하고 설계하기 위한 입력이다.

## 중요한 해석

### 감독형은 본질이 아니라 운용 모드다

Athena의 중심은 자율성이다. 운영자 감독은 현재 가장 잘 검증된 배포 방식이자 안전 장치다.

### 오케스트레이터는 방향키다

오케스트레이터는 제품 정체성이 아니다. 현재 목표, 제약, 평가 결과를 바탕으로 다음 작업이 목적에서 벗어나지 않도록 방향을 잡는 계층이다.

### Autoresearch는 자기 개선 탐색이다

Athena의 autoresearch는 여러 변형을 만들고, 실행하거나 시뮬레이션하고, 결과를 비교해, 실제 개선을 채택하고 퇴행을 버리는 메커니즘이다.

## 제품 원칙

- 목표 지향성
- 반복 가능성
- 근거 중심성
- 점진적 자율성
- 운영 가능성

## 현재 제품 위치

현재 Athena는 다음처럼 정의하는 것이 정확하다.

`운영자 감독 모드가 가장 잘 검증된 strong-beta 자율 연구 시스템`

## 관련 문서

- [Architecture Overview](./architecture-overview.md)
- [Current State Mapping](./current-state-mapping.md)
- [Onboarding](./onboarding.md)
- [Non-Goals](./non-goals.md)
- [Success Criteria](./success-criteria.md)
