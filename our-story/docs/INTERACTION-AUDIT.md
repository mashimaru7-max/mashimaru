# 인터랙션 참고 이미지 적용 현황

2026-11-13 코드와 화면 점검 기준. 참고 이미지는 패턴 선택 기준이며 24가지 예시를 모두 구현했다는 의미가 아니다. 아이보리·크림의 기존 디자인을 유지한다.

| 참고 패턴 | 적용 상태와 위치 |
| --- | --- |
| Hero section | 홈 대표 사진과 제목 |
| Responsive layout | 홈/여행/성장/갤러리의 모바일·PC 배치 |
| Card layout | 홈 사진 앨범·최근 추억·갤러리 |
| Bento grid | 이미지처럼 별도 구성한 Bento 격자는 미구현 |
| Sidebar layout | 성장앨범의 나이 타임라인 |
| Sticky header | 스크롤 중 상단 메뉴 유지 |
| Split layout | 여행 지도/프리뷰, 성장 대표 사진/타임라인 |
| Tabs | 여행 보기, 다온/라온/함께, 예시/NAS 앨범 전환 |
| Accordion | 미구현 |
| Modal / dialog | 기록 상세/입력, NAS 연결/사진 확대/관리 확인창 |
| Drawer | 독립적인 옆 슬라이드 패널은 미구현. 모바일 지도 프리뷰는 하단 시트 |
| Dropdown | 연도·카테고리·연결 방식의 기본 select |
| Tooltip | 별도 도움말 말풍선은 미구현. 지도 마커의 기본 이름 안내와 구분 |
| Toast / snackbar | 예시 저장·추가·삭제 및 NAS 작업 결과 안내 |
| Carousel | 미구현 |
| Skeleton loading | NAS 목록·사진을 실제로 요청할 때 로딩 표시 |
| Hover effect | 사진/버튼의 색·그림자 및 일부 사진 확대 |
| Scroll reveal | 홈 앨범/최근 추억이 화면에 진입할 때 등장 |
| Stagger animation | 홈 사진 등장 간격 45ms |
| Smooth transition | 버튼 상태와 모달·지도 시트·토스트 전환 |
| Glassmorphism | 미적용 |
| Parallax scrolling | 미적용 |
| Scroll snap | 미적용 |
| Micro-interaction | 버튼 누름 반응, 선택 탭·필터 상태 피드백 |

움직임 감소 설정에서는 애니메이션과 전환을 해제한다. 모바일에서 hover 없이 탭/클릭으로 기능을 사용할 수 있다. hover와 스크롤 효과가 있다고 미구현 컴포넌트를 완성됐다고 보고하지 않는다.

## 이번 수정

모든 앱 버튼과 이동 링크에서 장식 화살표를 제거했다. 홈 CTA·앨범 카드·최근 추억·여행/성장 상세·연결 여행·NAS 다운로드/폴더/설치 파일 링크를 포함한다. 아이콘만 있던 뒤로 가기는 `상위 폴더` 텍스트로 바꿨다. 사용하지 않는 `.arrow` 스타일도 삭제했다. 기본 select의 브라우저 드롭다운 표시와 지도 확대/축소 기능은 유지한다.
