"""Build a portable amd64 runtime from the image's distro-managed ffmpeg, retaining modes in tar."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote
source=Path(sys.argv[1] if len(sys.argv)>1 else '/source')
output=Path(sys.argv[2] if len(sys.argv)>2 else '/export');output.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'bin').mkdir();(root/'lib').mkdir();licenses=root/'licenses';licenses.mkdir()
    binary=shutil.which('ffmpeg')
    if not binary:raise RuntimeError('ffmpeg is missing')
    shutil.copy2(binary,root/'bin/ffmpeg')
    linked=subprocess.check_output(['ldd',binary],text=True)
    if 'not found' in linked:raise RuntimeError('Incomplete ffmpeg dependencies')
    for name in sorted(set(re.findall(r'(/[^\s()]+)',linked))):
        path=Path(name)
        if path.is_file():shutil.copy2(path,root/'lib'/path.name)
    loader=root/'lib/ld-linux-x86-64.so.2'
    if not loader.is_file():raise RuntimeError('Expected amd64 glibc runtime')
    # Fail the build if the archived loader/library set cannot run independently.
    subprocess.run([str(loader),'--library-path',str(root/'lib'),str(root/'bin/ffmpeg'),'-version'],stdout=subprocess.DEVNULL,check=True)
    shutil.copy2(source/'server.py',root/'server.py')
    for path in Path('/usr/share/doc').glob('*/copyright'):
        if path.is_file():shutil.copyfile(path,licenses/(path.parent.name+'-copyright.txt'))
    shutil.copytree('/usr/share/common-licenses',licenses/'common',dirs_exist_ok=True)
    installed=subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n'],text=True)
    (licenses/'packages.tsv').write_text(installed)
    sources=[]
    for line in installed.splitlines():
        parts=line.split('\t')
        if len(parts)==4:
            package,version,origin,source_version=parts
            sources.append('https://sources.debian.org/src/'+quote(origin,safe='')+'/'+quote(source_version,safe='')+'/')
    (licenses/'corresponding-source-urls.txt').write_text('\n'.join(sorted(set(sources)))+'\n')
    (root/'INSTALL.txt').write_text('우리라는 이야기 — 영상 썸네일\n\n'
        '1. our-story-api만 중지합니다. 기존 컨테이너를 삭제하지 않습니다.\n'
        '2. 이 압축 파일의 server.py, bin, lib, licenses를 docker/our-story/hotfix 폴더 안에 풉니다. 기존 server.py는 새 파일로 교체합니다. bin/lib 폴더의 실행 권한은 tar 원본을 유지합니다.\n'
        '3. API 컨테이너 볼륨 설정에 폴더 /docker/our-story/hotfix → /ffmpeg-runtime 매핑을 추가하고 읽기 전용을 체크합니다.\n'
        '4. 기존 /app/server.py, /photos, /settings, 환경변수, 네트워크 및 터널 설정은 그대로 둡니다. 저장 후 API를 시작합니다.\n'
        '5. 웹페이지를 새로고침하고 영상 폴더를 엽니다. 만들어진 JPEG는 /settings/video-thumbnails에 남습니다.\n\n'
        '이는 원본 영상 변환이나 NAS 전체에 프로그램 설치를 하는 것이 아닙니다. 재생하지 못하는 코덱도 ffmpeg가 해독할 수 있으면 썸네일을 표시합니다. 지원하지 않는/손상된 영상은 아이콘을 유지합니다.\n'
        'Debian FFmpeg 및 공유 라이브러리의 저작권/라이선스/대응 소스 위치는 licenses 폴더를 확인하세요.\n')
    with tarfile.open(output/'our-story-video-thumbnails.tar.gz','w:gz',compresslevel=6) as archive:
        for path in sorted(root.iterdir()):archive.add(path,arcname=path.name)
    print(json.dumps({'archive':'our-story-video-thumbnails.tar.gz','bytes':(output/'our-story-video-thumbnails.tar.gz').stat().st_size}))
