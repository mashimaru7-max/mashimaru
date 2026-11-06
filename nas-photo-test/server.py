#!/usr/bin/env python3
"""Read-only Synology photo browser. Standard library only."""
import json, os, hmac, mimetypes, urllib.parse, hashlib, secrets, time, threading
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT=Path("/photos").resolve()
TOKEN=os.environ.get("PHOTO_API_TOKEN","")
AUTH_FILE=Path("/data/login.json")
SESSIONS={}
LOCK=threading.Lock()
SESSION_TTL=7*24*3600

def password_hash(password,salt):
    return hashlib.pbkdf2_hmac("sha256",password.encode("utf-8"),bytes.fromhex(salt),350000).hex()

def auth_config():
    try:
        return json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None

def valid_session(header):
    candidate=header.removeprefix("Bearer ").strip()
    if not candidate:return False
    with LOCK:
        expiry=SESSIONS.get(candidate,0)
        if expiry<=time.time():
            SESSIONS.pop(candidate,None)
            return False
        return True
ORIGIN="https://mashimaru7-max.github.io"
IMAGE_EXT={".jpg",".jpeg",".png",".webp",".gif",".bmp",".heic",".heif"}
def resolve(rel):
    rel=urllib.parse.unquote(rel)
    if not rel or rel=="/": return ROOT
    if rel.startswith("/") or "\\x00" in rel or "\\\\" in rel: raise ValueError("Invalid path")
    p=(ROOT/rel).resolve()
    if not p.is_relative_to(ROOT): raise ValueError("Path outside photo root")
    return p
class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): pass
    def headers_common(self,typ):
        self.send_header("Content-Type",typ)
        self.send_header("Cache-Control","no-store")
        self.send_header("Access-Control-Allow-Origin",ORIGIN)
        self.send_header("Vary","Origin")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
    def json(self,code,obj):
        raw=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(code);self.headers_common("application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def read_json(self):
        size=int(self.headers.get("Content-Length","0"))
        if size<1 or size>4096:raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(size))
    def do_POST(self):
        if self.headers.get("Origin")!=ORIGIN:return self.json(403,{"error":"origin"})
        try:
            route=urllib.parse.urlsplit(self.path).path
            data=self.read_json()
            if route=="/api/setup":
                if auth_config() is not None:return self.json(409,{"error":"이미 비밀번호가 설정되어 있어"})
                password=data.get("password","")
                setup_token=data.get("setupToken","")
                if not isinstance(password,str) or len(password)<12 or len(password)>128:return self.json(400,{"error":"비밀번호는 12~128자로 설정해"})
                if not TOKEN or not hmac.compare_digest(str(setup_token),TOKEN):return self.json(401,{"error":"초기 설정 토큰이 올바르지 않아"})
                AUTH_FILE.parent.mkdir(parents=True,exist_ok=True)
                salt=secrets.token_hex(16)
                payload=json.dumps({"user":"maru","salt":salt,"hash":password_hash(password,salt)})
                with LOCK:
                    if AUTH_FILE.exists():return self.json(409,{"error":"이미 설정됨"})
                    fd=os.open(AUTH_FILE,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                    with os.fdopen(fd,"w",encoding="utf-8") as f:f.write(payload)
                return self.json(200,{"ok":True})
            if route=="/api/login":
                config=auth_config()
                if config is None:return self.json(409,{"error":"SETUP_REQUIRED"})
                username=data.get("username","")
                password=data.get("password","")
                if not isinstance(password,str) or not isinstance(username,str):return self.json(401,{"error":"아이디 또는 비밀번호 오류"})
                expected=config["hash"]
                valid=hmac.compare_digest(password_hash(password,config["salt"]),expected) and hmac.compare_digest(username,"maru")
                if not valid:
                    time.sleep(0.5)
                    return self.json(401,{"error":"아이디 또는 비밀번호 오류"})
                session=secrets.token_urlsafe(32)
                with LOCK:
                    SESSIONS[session]=time.time()+SESSION_TTL
                return self.json(200,{"session":session,"expiresIn":SESSION_TTL})
            if route=="/api/logout":
                session=self.headers.get("Authorization","").removeprefix("Bearer ").strip()
                with LOCK:SESSIONS.pop(session,None)
                return self.json(200,{"ok":True})
            return self.json(404,{"error":"Not found"})
        except (ValueError,TypeError,json.JSONDecodeError):return self.json(400,{"error":"Invalid request"})
        except OSError:return self.json(500,{"error":"로그인 데이터 저장 실패. /data 볼륨 확인"})
    def do_OPTIONS(self):
        if self.headers.get("Origin")!=ORIGIN: return self.json(403,{"error":"origin"})
        self.send_response(204);self.headers_common("text/plain")
        self.send_header("Access-Control-Allow-Headers","Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.end_headers()
    def do_GET(self):
        if self.headers.get("Origin")!=ORIGIN: return self.json(403,{"error":"origin"})
        if not valid_session(self.headers.get("Authorization","")):
            return self.json(401,{"error":"LOGIN_REQUIRED"})
        try:
            url=urllib.parse.urlsplit(self.path);qs=urllib.parse.parse_qs(url.query)
            rel=qs.get("path",[""])[0];p=resolve(rel)
            if url.path=="/api/status":
                return self.json(200,{"ok":True})
            if url.path=="/api/list":
                if not p.is_dir():return self.json(404,{"error":"Folder not found"})
                entries=[]
                for item in p.iterdir():
                    if item.name.startswith(".") or item.is_symlink():continue
                    try:
                        isdir=item.is_dir()
                        if not isdir and item.suffix.lower() not in IMAGE_EXT:continue
                        entries.append({"name":item.name,"path":item.relative_to(ROOT).as_posix(),"dir":isdir})
                    except (OSError,ValueError):continue
                entries.sort(key=lambda x:(not x["dir"],x["name"].casefold()))
                offset=max(0,min(int(qs.get("offset",["0"])[0]),1000000))
                return self.json(200,{"path":rel,"total":len(entries),"items":entries[offset:offset+100],"next":offset+100 if offset+100<len(entries) else None})
            if url.path=="/api/image":
                if not p.is_file() or p.suffix.lower() not in IMAGE_EXT:return self.json(404,{"error":"Not an image"})
                size=p.stat().st_size
                if size>15*1024*1024:return self.json(413,{"error":"Image exceeds 15MB preview limit"})
                mime=mimetypes.guess_type(p.name)[0] or "application/octet-stream"
                self.send_response(200);self.headers_common(mime);self.send_header("Content-Length",str(size));self.end_headers()
                with p.open("rb") as f:
                    while chunk:=f.read(65536):self.wfile.write(chunk)
                return
            self.json(404,{"error":"Not found"})
        except (ValueError,OSError,PermissionError) as e:self.json(400,{"error":type(e).__name__})
if __name__=="__main__":
    if len(TOKEN)<32 and not AUTH_FILE.exists():raise SystemExit("PHOTO_API_TOKEN must be at least 32 characters for first setup")
    ThreadingHTTPServer(("0.0.0.0",8080),Handler).serve_forever()
