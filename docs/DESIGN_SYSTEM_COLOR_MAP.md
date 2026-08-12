# 색상 매핑표 (192 → 토큰)

`DESIGN_SYSTEM.md` 9항의 부속 자료. CSS 치환 작업용이다.
왼쪽 토큰으로 오른쪽 hex 들을 모두 바꾼다.

| 토큰 | 흡수한 색 수 | 기존 hex |
| --- | --- | --- |
| `--c-text-soft` | 28 | #555555, #5a504a, #5c4c40, #5c524c, #5c534a, #5c534c, #5d5148, #5e5149, #604938, #62574f, #655b52, #66554b, #695242, #6b5b4b, #6b6258, #6c5b50, #6d6259, #6e625b, #6f655d, #705a4b, #75685d, #75685e, #76675c, #76685d, #766960, #766b61, #796d62, #7a6a5c |
| `--c-text` | 26 | #1e1a18, #241f1c, #2a2420, #2f2a26, #2f2f2f, #322c27, #342f2a, #3a322c, #3b2d24, #3d1e00, #3d3530, #3e342d, #3f332a, #3f362f, #402f26, #403831, #444444, #453b35, #4a2a2a, #4a4038, #4a423c, #4e4339, #4e4741, #4f4035, #51463e, #51473f |
| `--c-border` | 24 | #d8d5d0, #ddd4cc, #ded5c9, #dfd4c7, #e0d7cb, #e2d2c3, #e2d6cb, #e2d8cd, #e3d8cc, #e4d8ca, #e4dbd0, #e4ddd2, #e6d9cd, #e6ddd1, #e6ddd2, #e7ddd2, #e7ddd4, #e7dfd6, #e8ddd4, #e8ded3, #e9d4bf, #eadfd6, #efe0d1, #f3dcd6 |
| `--c-brand-strong` | 18 | #68482f, #6d513f, #6f533f, #755b48, #76573f, #7a3f3f, #7a5a1f, #7a6250, #805f48, #80654f, #8a5f43, #8a6a4f, #8a6f55, #8d6a4f, #927862, #9a7559, #9d7960, #a66a5d |
| `--c-bg-soft` | 17 | #f0ebe6, #f3ebe1, #f3ebe3, #f3eee7, #f3eee8, #f3efe8, #f4ede4, #f5eee6, #f5efe9, #f6eee7, #f6efe8, #f6f1e9, #f6f1ea, #f7eee3, #f7efe7, #f8f1ea, #fbf4ec |
| `--c-brand-soft` | 15 | #ebe2d8, #ebe4d8, #ede4da, #eee3d9, #eee5dc, #eee6dd, #efe2cf, #efe4d9, #efe5da, #efe6da, #efe6dd, #efe8dd, #f0e4d8, #f3e8dd, #f4e8db |
| `--c-bg` | 12 | #f1efec, #f7f1ec, #f7f3ee, #f7f4ef, #faf6f0, #faf6f1, #faf7f2, #faf7f4, #fcf8f4, #fffaf5, #fffdf8, #fffdf9 |
| `--c-danger` | 9 | #a14f45, #a33b2e, #a5503c, #a65f56, #a84135, #b42318, #b4544a, #b85c4c, #c0392b |
| `--c-text-muted` | 7 | #77736e, #777777, #7a7168, #84736a, #89776b, #8a7a6e, #9a7f6a |
| `--c-text-subtle` | 7 | #9a9086, #9a9088, #a29489, #a2948a, #a3958a, #b5a498, #b8a99c |
| `--c-border-strong` | 7 | #c9b8a8, #d4b59a, #d8c4b2, #d9cec2, #d9cec3, #d9cec4, #ddcbbb |
| `--c-warning-soft` | 5 | #fbf1dd, #fdf3e6, #fff1df, #fff5ec, #fff8ef |
| `--c-brand` | 4 | #a07d62, #af8468, #b48c6e, #c9a27e |
| `--c-success` | 3 | #2e6b39, #3d6b49, #5f8f6d |
| `--c-surface` | 2 | #fffdfa, #ffffff |
| `--c-danger-soft` | 2 | #fbeeec, #fdecea |
| `--c-success-soft` | 2 | #cfe8d3, #edf8ef |
| `--c-warning` | 2 | #8a5a12, #d9a441 |
| `--c-kakao` | 1 | #fee500 |

## 주의 — 수동 확인이 필요한 14색

색 거리(ΔE)가 12를 넘어 눈에 띄게 달라지는 값들이다. 사용 빈도는 1~4회다.
치환 후 해당 화면을 눈으로 확인한다.

| 기존 | 사용 | 배정 토큰 | ΔE |
| --- | --- | --- | --- |
| `#b42318` | 4 | `--c-danger` | 27.3 |
| `#7a3f3f` | 1 | `--c-brand-strong` | 22.3 |
| `#3d1e00` | 1 | `--c-text` | 22.0 |
| `#c0392b` | 1 | `--c-danger` | 21.1 |
| `#8a5a12` | 1 | `--c-warning` | 19.0 |
| `#7a5a1f` | 2 | `--c-brand-strong` | 18.9 |
| `#68482f` | 1 | `--c-brand-strong` | 14.1 |
| `#5f8f6d` | 1 | `--c-success` | 14.1 |
| `#1e1a18` | 2 | `--c-text` | 13.4 |
| `#a66a5d` | 1 | `--c-brand-strong` | 13.0 |
| `#604938` | 3 | `--c-text-soft` | 12.7 |
| `#4a2a2a` | 1 | `--c-text` | 12.6 |
| `#a65f56` | 1 | `--c-danger` | 12.3 |
| `#6d513f` | 1 | `--c-brand-strong` | 12.1 |


---

## ⚠️ 웜코랄 전환에 따른 변경 (2026-08-02)

이 표는 베이지 팔레트 기준으로 만들어졌다. 토큰 **이름**은 대부분 그대로지만
`--c-brand-strong` 하나가 둘로 나뉘었다.

| 기존 | 새 토큰 | 판단 기준 |
| --- | --- | --- |
| `--c-brand-strong` | `--c-brand-action` | **버튼·요소의 배경**으로 쓰이던 자리 |
| `--c-brand-strong` | `--c-brand-text` | **글자·아이콘 색**으로 쓰이던 자리 |

`--c-brand-strong` 으로 배정된 18개 색은 **쓰임을 보고 둘 중 하나로 나눠야 한다.**
기계적 치환이 불가능한 유일한 항목이다.

그리고 `--c-brand`(`#ff6b6b`)에는 **글자를 얹지 않는다.**
기존에 `#b48c6e` 위에 흰 글자를 쓰던 자리는 `--c-brand-action` 으로 바꾼다.
