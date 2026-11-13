# 앨범 UI 정리 — 2026-11-13

원안의 크림 종이, 피치빛, 잎사귀/들꽃, 둥근 앨범 표지, 폴라로이드 사진 느낌을 반영했다. PC 표지는 제목과 사진을 나누고 모바일에서는 제목 다음에 사진을 배치하여 얼굴을 가리지 않는다. 사진은 contain으로 전체를 표시한다. NAS 설정 안내는 작은 보조 영역으로 줄였다. 홈·여행·성장·갤러리에 같은 색상/아이콘 체계를 적용하되 지도·사진 모음·성장 스프레드 배치는 유지한다.

메뉴의 사각형은 style.css에서 화살표 스타일 제거 후 남은 `button, nav a,` 선택자가 다음 `button:active` 규칙과 이어져 상시 inset shadow를 적용한 버그였다. 선택자를 분리하고 상시 그림자를 제거했다. 키보드 focus-visible은 유지한다. 임시 ▧/⌂ 기호는 폰트에 의존하지 않는 SVG로 교체했다.

가족이 첨부한 비공개 사진은 공개 자산에 넣지 않았다. 테스트에는 기존 스톡 사진과 가상 NAS/별도 QA 저장소만 사용했다. NAS 서버와 원본, 연결/폴더 규칙 저장 구조는 변경하지 않았다.

## 자산

- `assets/meadow-border.webp`: 배경용 수채화 장식. 내장 이미지 생성으로 제작한 RGBA 원본을 alpha 보존 WebP로 변환(약 181KB). 원본: `/workspace/scratch/918563948daa/generated_images/exec-f4155fd7-984d-4047-86ce-496ccff507c6.png`.
- 생성 프롬프트: “Very wide panoramic watercolor meadow and botanical ornament on genuinely transparent background; soft pale sage and warm golden hills along the bottom; tiny yellow wildflowers and olive leaves at the corners; upper 70 percent transparent; elegant warm family photo album; no people, faces, text, logos or UI.”
- `assets/leaf-spray.svg`, `assets/paper-grain.svg`, `icons.js`: 직접 작성한 장식/종이 질감/아이콘. 외부 아이콘 폰트 불필요.
- `album-theme.css`: 기능 CSS 뒤에 로드하는 앨범 디자인 레이어.

## 확인

PC 및 390px 모바일 주요 화면에서 메뉴 상시 그림자 없음, SVG 아이콘 표시, 가로 넘침 없음, 표지 제목/사진 영역 미중첩, contain 표시, 모바일 두 앨범 입구 표시를 확인했다. 가상 NAS에서 대표 사진, 자동 앨범 8장, 아이 선택, 저장된 숫자 이름 규칙 및 갤러리 동작을 확인했다. 기존 JS 테스트 63개 통과. 실제 사용자 NAS 사진 검증과 구분한다. 사용자 요청에 따라 이후 가벼운 UI 수정에는 해당 부분의 짧은 확인만 수행한다.
