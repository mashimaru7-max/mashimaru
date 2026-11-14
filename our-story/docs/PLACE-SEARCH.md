# 여행 위치 찾기

- 여행 입력폼의 국가·도시·지역 또는 별도 검색어를 명시적으로 검색한다. 첫 후보 좌표를 선택하고 다른 후보/지도 탭으로 조정한다. 입력한 여행 제목·본문·사진·NAS 인증정보는 검색 서비스에 전송하지 않는다.
- Nominatim 공개 검색을 가족의 수동 검색에만 사용한다. 자동완성/백그라운드 탐색은 하지 않는다. 요청 직렬화, 1.1초 간격, 탭 간 Web Locks와 시간 공유, 메모리 결과 캐시, 출처 표시를 유지한다. 기기 간 전역 속도 제한은 없다. 공개 서비스/다수 가족용으로 확대하기 전에 서버 프록시로 전역 1req/sec 제한과 영구 캐시를 구현하거나 별도 검색 제공자를 사용해야 한다. 제공자 주소는 place-search.mjs의 PLACE_SEARCH_URL에서 교체한다.
- 영문 우선 OpenFreeMap Liberty 스타일을 로컬 JSON으로 보관한다. 영어 이름 → 영문 필드 → 로마자 → 원문 순으로 표시한다. 모든 장소의 영문 번역을 보장하지 않는다. WebGL/지도 로딩 실패 시 기존 OSM 지도와 안내를 표시한다.
- MapLibre GL JS 5.6.2 및 Leaflet 바인딩 0.1.0은 버전 고정·SRI 해시로 CDN에서 읽는다. 기존 Leaflet 핀과 저장 좌표/기록 API는 유지한다. NAS 업데이트는 필요 없다.
- 정책: https://operations.osmfoundation.org/policies/nominatim/ , https://openfreemap.org/quick_start/ , https://openfreemap.org/
