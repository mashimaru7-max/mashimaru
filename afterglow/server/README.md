> 현재 운영 서버는 Sites의 Cloudflare Worker + D1/R2를 사용합니다. 아래 Node API는 별도 서버를 사용할 때의 실행 예시입니다.

# AFTERGLOW 저장 API

Node.js 22 이상에서 `node server/server.js`로 실행합니다. HTTPS 리버스 프록시 뒤에 배치하고 `AFTERGLOW_DATA_DIR`을 영구 디스크 경로로 설정합니다. `PORT` 기본값은 8080, `AFTERGLOW_ORIGIN` 기본값은 https://mashimaru7-max.github.io 입니다.

서버 주소를 `server-config.js`의 `API_URL`에 넣고 GitHub Pages에 반영하면 방문자는 서버의 그림과 라운드를 읽고 관리자는 기존 지정 비밀번호로 저장합니다. 서버는 비밀번호 해시를 확인하고 1시간 유효한 서명 토큰을 발급합니다. 토큰은 브라우저 메모리에만 유지됩니다. 관리자 로그인 실패 10회 뒤 해당 IP에서 10분 동안 차단합니다.

영구 데이터: `afterglow.json`(라운드/그림)과 `session-key`(서명 키). 둘 다 백업합니다. 파일 쓰기는 순서대로 임시 파일을 만든 뒤 이름을 변경합니다. 단일 프로세스 전용입니다. 브라우저에서는 최대 20MB 원본을 1600px JPG로 줄이며 서버는 그림 한 장 최대 3MB를 받습니다. GIF는 정지 그림으로 저장합니다.

현재 게임은 Sites 저장 서버에 연결되어 있습니다. `API_URL`이 비어 있으면 기존 브라우저 저장 모드이며 서버 저장 성공으로 표시하지 않습니다.
