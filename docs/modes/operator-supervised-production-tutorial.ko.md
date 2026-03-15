# Athena 감독형 운영 모드 프로덕션 튜토리얼

## 목적

이 문서는 Athena의 감독형 운영 모드를 끝까지 검증하는 방법을 설명합니다.

중요한 점은 이것이 Athena의 제품 정의가 아니라는 것입니다.

Athena의 본질은 `자율형 연구 시스템`이고, 감독형은 그 시스템을 운영하는 여러 방식 중 하나입니다.

## 이 문서가 다루는 것

- 감독형 soak 검증
- 체크리스트 해석
- evidence 문서 갱신
- bounded autonomy가 실제로 안전하게 동작하는지 확인

## 이 문서가 다루지 않는 것

- Athena의 전체 제품 정의
- Athena를 supervision-first 시스템으로 재정의하는 것

제품 정의는 [README.md](/Users/hanji/Desktop/Project%20Vault/03-Athena/Athena/README.md)와 [vision.md](/Users/hanji/Desktop/Project%20Vault/03-Athena/Athena/docs/vision.md)를 기준으로 봐야 합니다.
