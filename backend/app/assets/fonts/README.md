# 인쇄용 한글 글꼴 — Noto Sans KR (SIL OFL 1.1)

서버에서 PDF 를 그릴 때 심는 글꼴이다(`app/services/album_pdf_service.py`). 굵기는 **둘**뿐이다.

| 파일 | 굵기 | 쓰는 자리 |
| --- | --- | --- |
| `NotoSansKR-Regular.ttf` | 400 | 본문 · 캡션 아래 줄 · 주소 |
| `NotoSansKR-Bold.ttf` | 700 | 제목 · 캡션 · 숫자 요약 |

## 왜 Noto Sans KR 인가
화면은 기기 글꼴(Apple SD Gothic Neo · Malgun Gothic)을 쓴다 — 종이에는 기기가 없으니
하나를 골라 심어야 한다. 시안은 Pretendard 를 쓰지만 Pretendard 는 **TrueType 정적 판을
배포하지 않는다**(OTF/CFF 는 ReportLab 이 못 심는다). 그래서 같은 계열의 Noto Sans KR.

## 어떻게 만들었나 (다시 만들 때)
Google Fonts 의 가변 글꼴 `NotoSansKR[wght].ttf` 에서 fontTools 로 정적 두 판을 뽑았다.
```
pip install fonttools
python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
for wght, name in ((400, "Regular"), (700, "Bold")):
    # updateFontNames 가 없으면 이름표가 기본 인스턴스(Thin)로 남는다 — PDF 안에서 그 이름이 보인다.
    font = instancer.instantiateVariableFont(TTFont("NotoSansKR[wght].ttf"), {"wght": wght}, inplace=True, updateFontNames=True)
    font.save(f"NotoSansKR-{name}.ttf")
PY
```
출처: https://github.com/google/fonts/tree/main/ofl/notosanskr · 라이선스는 옆의 `OFL.txt`.
한자(CJK 통합 한자)를 **빼지 않았다** — 회고 앨범에 祝·壽 같은 글자가 들어올 수 있다.
