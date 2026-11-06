#!/usr/bin/env python3
"""Read-only Synology photo browser. Standard library only."""
import json, os, hmac, mimetypes, urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT=Path("/photos").resolve()
TOKEN=os.environ.get("PHOTO_API_TOKEN","")
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
    def do_OPTIONS(self):
        if self.headers.get("Origin")!=ORIGIN: return self.json(403,{"error":"origin"})
        self.send_response(204);self.headers_common("text/plain")
        self.send_header("Access-Control-Allow-Headers","Authorization")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.end_headers()
    def do_GET(self):
        if self.headers.get("Origin")!=ORIGIN: return self.json(403,{"error":"origin"})
        if not TOKEN or not hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+TOKEN):
            return self.json(401,{"error":"Invalid access token"})
        try:
            url=urllib.parse.urlsplit(self.path);qs=urllib.parse.parse_qs(url.query)
            rel=qs.get("path",[""])[0];p=resolve(rel)
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
    if len(TOKEN)<32:raise SystemExit("PHOTO_API_TOKEN must be at least 32 characters")
    ThreadingHTTPServer(("0.0.0.0",8080),Handler).serve_forever()
