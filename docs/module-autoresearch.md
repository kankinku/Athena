# 모듈별 Autoresearch 루프

이 문서는 각 모듈 또는 작업 단위에서 Athena가 어떻게 자기 개선을 반복하는지 설명한다.

## 역할

모듈별 autoresearch는 전체 제품의 축소판이다.

```text
module goal
  -> collect local evidence and relevant references
  -> compare candidate changes
  -> choose one bounded change
  -> execute or simulate
  -> evaluate
  -> keep, discard, or revisit
  -> repeat
```

## 기본 제약

- 변경 범위는 허용된 경로 안에 있어야 한다.
- 공용 인터페이스나 고위험 변경은 상위 게이트를 통과해야 한다.
- 예산, 시간, 비용, 파일 수 제한 안에서만 반복한다.

## 목표 함수

모듈마다 측정 기준은 다르지만 공통 원칙은 같다.

- 테스트 통과
- 목표 지표 개선
- 회귀 최소화
- 계약 유지

## 채택 규칙

- 개선되면 유지한다.
- 개선이 없으면 버린다.
- 악화되면 즉시 폐기한다.
- 범위를 벗어나면 상위 planning 또는 협의 경로로 올린다.

## 중요 해석

모듈 autoresearch는 제품 전체를 대체하지 않는다. 전체 자율 연구 루프의 수집, 비교, 계획, 실행, 평가 단계를 더 작은 범위에서 반복하는 방식이다.
