# 우리라는 이야기 · NAS 관리 API v2

기존 `nas-photo-test`를 교체하지 않는 별도 서비스다. **현재 NAS에는 설치되지 않았다.** 기본 compose는 읽기 전용이다. 업로드·휴지통을 활성화하려면 사용자의 NAS 쓰기 권한 변경 승인이 필요하다.

## 변경 이유와 영향

기존 사진 API는 조회만 지원한다. 웹페이지 버튼만으로 업로드/삭제를 구현할 수 없다. 새 컨테이너 `our-story-api`와 별도 터널 `our-story-tunnel`을 추가한다. 기존 서버·터널은 중단하거나 변경하지 않는다. 새 Quick Tunnel 주소를 웹의 연결 설정에 입력하면 기존 토큰을 재사용할 수 있다.

쓰기 활성화 시 `/volume1/photo`의 읽기 전용 마운트를 새 컨테이너에 한해서 읽기/쓰기로 바꾼다. 사진 업로드는 선택한 기존 폴더에 새 파일을 추가한다. 같은 이름은 덮어쓰지 않는다. 삭제 요청은 선택한 파일을 `/volume1/photo/.our-story-trash/<id>/photo`로 이동한다. 원래 경로와 삭제 시각은 같은 비공개 폴더의 `metadata.json`에 기록한다. 휴지통은 일반 갤러리에 표시하지 않고 자동으로 비우지 않는다. 원본 파일 내용과 EXIF는 바꾸지 않는다. 썸네일만 RAM에서 변환하며 원본에 쓰지 않는다. 복원은 원래 폴더에 같은 이름이 있으면 중단한다. 영구 삭제 기능은 제공하지 않는다.

기존 토큰은 새 쓰기 API에도 접근할 수 있게 되므로 토큰을 아는 사람은 쓰기 권한을 갖는다. 가족별 로그인과 권한은 아직 없으며, NAS 관리자는 나중에 별도 관리 토큰으로 분리할 수 있다. CORS는 페이지 origin을 검사하지만 토큰 유출에 대한 접근 통제 대체 수단은 아니다. 실제 `.env`, 토큰, 사진은 Git에 포함하면 안 된다.

## 휴대폰에서도 준비할 수 있는 설치 자료

- 소스 묶음: `../downloads/our-story-nas-service.zip` (비밀 없음)
- GitHub 저장소 → Actions → **Build Our Story NAS service image** → 완료된 실행의 Artifacts → `our-story-nas-amd64` 다운로드. ZIP을 풀면 Docker 가져오기용 `our-story-nas-amd64.tar`가 있다. 유효기간 7일. 필요하면 Run workflow로 다시 만든다. DS218+용 linux/amd64 이미지이며 NAS에는 자동 설치하지 않는다.
- Docker 이미지 실제 빌드 여부는 해당 Actions 실행 결과를 확인한다. DSM 7.1.1 설치/권한 호환성은 실제 NAS에서 별도 확인해야 한다.

## DSM Docker GUI로 별도 컨테이너 추가 (승인 이후)

1. 먼저 실제 `/photo` 공유 폴더 백업/스냅샷 상태와 사진 권한이 있는 DSM 계정 UID/GID를 확인한다. 예시 `1024:100`은 설치마다 다르며 관리자/root 권한으로 우회하지 않는다.
2. File Station에 tar 파일 업로드 → Docker → 이미지 → 추가 → 파일에서 추가로 가져온다. 기존 Python/cloudflared 컨테이너는 유지한다.
3. 새 Docker 브리지 네트워크 `our-story-net` 생성. `our-story-nas:2` 이미지로 **새 컨테이너** `our-story-api` 생성. 새 네트워크에만 연결한다. 호스트 네트워크·공개 호스트 포트는 사용하지 않는다.
4. 볼륨에 실제 `photo` 공유 폴더를 `/photos`로 추가하고 **우선 읽기 전용**을 체크한다. 환경 변수 `NAS_TOKEN`에 기존 조회 토큰, `ALLOWED_ORIGIN=https://mashimaru7-max.github.io`, `ENABLE_WRITES=0` 설정. 비밀을 웹 코드나 GitHub Actions에 입력하지 않는다. 기본 이미지 사용자는 `1024:100`이므로 실제 계정이 다르면 적절한 사용자로 컨테이너를 구성해야 한다. GUI에서 사용자 지정이 어려우면 아래 compose 경로를 사용한다.
5. 이미 내려받은 공식 `cloudflare/cloudflared` 이미지로 **새 컨테이너** `our-story-tunnel` 생성. `our-story-net`에 연결. 명령: `tunnel --no-autoupdate --url http://our-story-api:8000`. 네트워크에서 이름 해석이 되는지 로그 확인. 기존 터널은 수정하지 않는다.
6. 새 터널 로그의 HTTPS 주소를 웹 연결 설정에 입력. 토큰 칸은 비워 저장된 토큰을 재사용한다. 목록/썸네일/다운로드부터 확인한다. Quick Tunnel 주소는 재시작 시 바뀔 수 있다.
7. **쓰기 승인 후에만** 새 API 컨테이너의 사진 볼륨을 읽기/쓰기로 바꾸고 `ENABLE_WRITES=1` 설정. DSM에서 컨테이너 재생성이 필요한 경우 새 컨테이너만 재생성한다. 먼저 별도 시험 폴더에서 사진 한 장 업로드 → 휴지통 이동 → 복원을 검증한다. 권한이 안 맞으면 서버가 403을 반환하며 원본 권한을 임의로 완화하지 않는다.

이 단계는 실제 NAS 화면을 확인하며 진행해야 하며, 이 문서는 설치 완료를 의미하지 않는다.

## Compose 사용 가능 시

로컬 NAS 전용 폴더에서 `.env.example`을 `.env`로 복사하고 토큰과 실제 UID/GID 입력. 읽기 전용 실행:

```sh
docker-compose -p our-story -f docker-compose.yml up -d
```

쓰기 승인 이후 실행:

```sh
docker-compose -p our-story -f docker-compose.yml -f docker-compose.write.yml up -d
```

빌드된 이미지를 Docker GUI로 가져온 경우 이미지를 재사용한다. 서버 코드는 원본 프로젝트를 참조하지 않는다. 이 예시는 DS218+의 실제 볼륨이 `/volume1/photo`인 경우이며 경로는 실제 환경에 맞춰야 한다. 롤백 시 새 컨테이너/터널만 정지하고 원래 웹 연결 주소로 돌아간다. 휴지통 폴더는 지우지 말고 필요한 파일을 먼저 복원한다.

## API 계약

모든 요청은 `Authorization: Bearer ...`, 정확한 `Origin` 필요. OPTIONS만 토큰 없이 허용 origin 검사. 토큰은 URL에 넣지 않는다. 쿠키·공개 정적 사진 URL·인증 없는 썸네일 없음.

| 경로 | 동작 |
| --- | --- |
| GET `/api/capabilities` | v2 지원 기능과 쓰기 권한 표시 |
| GET `/api/list?path=&offset=0` | 100개 단위 목록, revision 포함 |
| GET `/api/image?path=...` | 원본 미리보기, 최대 15MB |
| GET `/api/thumbnail?path=...` | 최대 1600px JPEG, EXIF 제거, Pillow가 지원하는 형식만 |
| GET `/api/download?path=...` | 원본 다운로드, 최대 128MB |
| POST `/api/upload?path=...&name=...` | raw binary, 파일당 64MB, 지원 사진 확장자·서명/디코딩 검사 |
| POST `/api/trash` | JSON `{path, revision}`, 휴지통 이동 |
| GET `/api/trash` | 휴지통 목록 최대 1000개 |
| POST `/api/restore` | JSON `{id}`, 원래 위치로 복원 |

심볼릭 링크·숨김 폴더·상위 경로·URL 이중 디코딩 경로를 거부한다. 디렉터리 파일 디스크립터를 기준으로 접근한다. 쓰기 작업은 서버 내 잠금으로 직렬화하며 외부 Synology Photos/SMB의 동시 편집까지 잠그지는 못한다. 그 외부 프로그램과 같은 파일을 동시에 변경하지 말아야 한다. 프로세스 중단 시 숨김 업로드 임시 파일 또는 미완성 휴지통 메타데이터가 남을 수 있으며 자동 정리/영구 삭제하지 않는다. 운영 전 백업과 장애 복구 점검이 필요하다.

썸네일 동시 변환 2개, HTTP 요청 최대 8개. HEIC/HEIF 코덱 플러그인은 포함하지 않아 해당 형식의 썸네일은 실패할 수 있다. 파일 자체 다운로드는 지원한다. 영상·대량 ZIP·폴더 삭제·영구 삭제·GPS 자동 분류·가족별 인증·고정 터널은 구현 범위 밖이다.

## 검증

Python 3.12 이상/Linux와 Pillow 13.0.0 대상. 현재 임시 디렉터리 HTTP 시험 14개 통과. 실제 NAS·DSM 설치와 네트워크는 미검증. 실행:

```sh
python -m unittest discover -s our-story/tests -p test_nas_service.py -v
```
