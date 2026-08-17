# 랜덤 여행지 V5

대한민국 여행 후보를 조건별로 무작위 추천하는 GitHub Pages용 정적 웹앱입니다. 장소 데이터는 `data/places.json`, 화면과 랜덤 로직은 `assets/`로 분리되어 있습니다.

## GitHub Pages에 올리기

1. 이 폴더 안의 파일과 폴더를 GitHub 저장소 최상단에 업로드합니다.
2. 저장소에서 **Settings → Pages**를 엽니다.
3. **Build and deployment**에서 **Deploy from a branch**를 선택합니다.
4. Branch를 `main`, 폴더를 `/(root)`로 정한 뒤 **Save**합니다.
5. 잠시 뒤 표시되는 `https://사용자이름.github.io/저장소이름/` 주소로 접속합니다.

## 데이터 수정

`data/places.json`의 각 장소는 `id`, `name`, `province`, `city`, `category`, `lat`, `lng`, `access`, `family` 속성을 가집니다. `category`는 `landmark`, `place`, `nature`, `history`, `park` 중 하나이고, `access`는 `A`(차량 접근 쉬움) 또는 `B`(짧은 도보 포함)입니다.

## 참고

- 지도와 장소 데이터 불러오기는 HTTPS로 배포된 GitHub Pages에서 사용하세요. `file://`로 직접 열면 JSON 데이터 요청이 브라우저 보안 정책에 막힐 수 있습니다.
- 지도 타일은 OpenStreetMap에서 실패할 경우 CARTO 타일로 자동 재시도합니다.
- 지도는 Leaflet 및 OpenStreetMap/CARTO 타일을 사용합니다. 해당 서비스의 이용 정책을 지켜주세요.


## 장소 데이터 출처

기본 후보와 함께, 박물관·테마파크·공원·자연경관 등 가족 여행에 어울리는 장소를 보강했습니다. 보강 데이터는 OpenStreetMap 기여자 데이터에서 추출했으며, © OpenStreetMap contributors · [ODbL](https://www.openstreetmap.org/copyright) 조건을 따릅니다. 장소 운영 여부·입장 조건·안전 정보는 출발 전 확인하세요.
