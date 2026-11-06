# NAS 사진 목록 테스트 (독립 실험)
DS218+ / DSM 7.1.1 / Docker. NAS 사진을 **읽기 전용**으로 조회하는 초소형 Python API와 임시 HTTPS Cloudflare Quick Tunnel, GitHub Pages UI입니다.

## 안전 장치
- `/volume1/photo`는 Docker에서 `:ro`로 마운트. **볼륨 경로가 실제 사진 공유 폴더와 일치하는지 확인**하세요. 다르면 수정.
- 컨테이너는 관리자 권한 없이 UID 1024로 실행. 해당 UID에 사진 읽기 권한이 없으면 권한 오류가 날 수 있습니다. 무턱대고 `root`로 바꾸지 마세요.
- 외부 포트 매핑 없음. DDNS/공유기 포트 포워딩 필요 없음.
- 랜덤 토큰으로 인증. 토큰은 GitHub에 커밋하지 않고 NAS에만 저장.
- Cloudflare Quick Tunnel은 **실험용**입니다. URL이 매번 바뀔 수 있고 서비스 보장이 없습니다. 터널 제공자가 네트워크 트래픽을 중계합니다.
- 이 구성은 가족사진을 외부 서비스에 전송하지 않는다는 뜻은 아닙니다. **브라우저에서 사진 미리보기를 누르면 사진 데이터가 Cloudflare를 통해 전달됩니다.** 민감한 사진은 미리보기하지 마세요.
- UI의 토큰은 메모리에만 유지하고 새로고침 시 지워집니다. 브라우저 개발자 도구·확장 프로그램 등에서는 접근 가능할 수 있습니다. 공용 기기에서 사용하지 마세요.
- 파일명과 경로는 민감 정보입니다. 타인에게 로그·스크린샷 공유 시 주의.
- NAS의 사진 폴더 권한이나 원본 파일은 변경하지 마세요.

## NAS 실행 (SSH 가능한 PC 권장)
1. DSM **제어판 → 터미널 및 SNMP → SSH 서비스 활성화**. 작업 후 다시 비활성화. 외부 SSH 포트 포워딩은 금지. **QuickConnect로 SSH 접속은 지원되지 않으므로 집 LAN 또는 기존 VPN에서 실행**해야 합니다.
2. NAS의 `/volume1/docker/family-photo-test`에 `server.py`와 `docker-compose.yml`을 다운로드해 넣으세요. File Station 업로드 가능.
3. 같은 폴더에 `.env`를 만들고 `PHOTO_API_TOKEN=` 뒤에 **32자 이상의 무작위 비밀 문자열**을 넣으세요. 예: 로컬 터미널에서 `openssl rand -hex 32` 실행. **토큰을 채팅이나 GitHub에 올리지 마세요.**
4. 사진 공유 폴더의 실제 볼륨이 `/volume1/photo`인지 확인. 다른 볼륨이면 compose의 마운트 경로를 변경하세요.
5. NAS SSH에서 해당 폴더로 이동해 `sudo docker-compose up -d` 실행. 일부 설치 환경에서는 `sudo docker compose up -d`를 사용합니다.
6. `sudo docker-compose logs --tail=40 tunnel`에서 `https://...trycloudflare.com` 주소를 확인. 1분가량 걸릴 수 있습니다. Quick Tunnel 생성 실패 시 네트워크/DNS를 확인.
7. GitHub Pages의 `/nas-photo-test/` 페이지에서 터널 URL과 토큰을 입력하고 폴더 목록을 확인하세요. **NAS 계정 비밀번호는 입력하지 않습니다.**
8. 종료: `sudo docker-compose down` (환경에 따라 `docker compose down`). 터널 주소도 무효화됩니다.

## 검증 기준
- 첫 페이지에서 `My_Photo`, `은예네` 등 기존 공유 폴더 이름이 표시되면 **원격 목록 조회 성공**.
- 폴더를 클릭해 연도별 하위 폴더 탐색.
- 사진 미리보기는 선택적으로 15MB 이하의 JPEG/PNG/WebP 등만. HEIC는 브라우저가 표시하지 못할 수 있습니다.
- 인증 오류(401), 읽기 권한 오류(400), Cloudflare 연결 오류는 서로 다른 문제입니다.

## 현재 한계
- 외부 인증/사용자별 접근 제어는 **테스트 토큰 하나**만 사용. 가족 실서비스로 쓰면 안 됩니다.
- 사진 목록을 매 요청마다 읽기 때문에 수만 장 폴더는 느릴 수 있습니다.
- 메타데이터/얼굴 인식/썸네일 자동 생성은 아직 구현하지 않았습니다.
- DSM 7.1의 Docker GUI는 compose 관리가 제한될 수 있습니다. 집 밖에서 SSH 경로가 없다면 집에 돌아가 실행하세요.
