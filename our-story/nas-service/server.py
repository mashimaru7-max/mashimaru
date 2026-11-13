"""Separate NAS photo service. Never modifies the existing nas-photo-test service.
Linux only: descriptor-relative paths, no symlink traversal, read-only by default.
"""
import contextlib
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import stat
import sqlite3
import unicodedata
import threading
import time
import uuid
import warnings
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit, quote
try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 50_000_000
    warnings.simplefilter('error', Image.DecompressionBombWarning)
except ImportError:
    Image = ImageOps = None

MAX_UPLOAD = 64 * 1024 * 1024
MAX_DOWNLOAD = 128 * 1024 * 1024
PHOTO = re.compile(r'\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$', re.I)
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
TRASH = '.our-story-trash'

class APIError(Exception):
    def __init__(self, status): self.status = status

def parts(path):
    if not isinstance(path, str) or len(path) > 4096 or '\\' in path or '%' in path or any(ord(c) < 32 or ord(c) == 127 for c in path): raise APIError(400)
    values = path.split('/') if path else []
    if any(not p or p.startswith('.') or p.lower().startswith('@eadir') for p in values): raise APIError(400)
    return values

def revision(st):
    return hashlib.sha256(f'{st.st_dev}:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}:{st.st_ctime_ns}'.encode()).hexdigest()

def photo_magic(name, data):
    ext = name.rsplit('.', 1)[-1].lower()
    if ext in ('jpg', 'jpeg'): return data.startswith(b'\xff\xd8\xff')
    if ext == 'png': return data.startswith(b'\x89PNG\r\n\x1a\n')
    if ext == 'gif': return data.startswith((b'GIF87a', b'GIF89a'))
    if ext == 'webp': return data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    if ext == 'bmp': return data.startswith(b'BM')
    if ext in ('heic', 'heif', 'avif'):
        brands = data[8:32]
        return data[4:8] == b'ftyp' and any(b in brands for b in (b'heic', b'heix', b'hevc', b'mif1', b'avif', b'avis'))
    return False

class PhotoStore:
    def __init__(self, root, writable=False):
        self.root = os.open(root, DIR_FLAGS)
        self.writable = writable
        self.lock = threading.RLock()
        self.image_slots = threading.BoundedSemaphore(2)

    @contextlib.contextmanager
    def directory(self, path):
        fd = os.dup(self.root)
        try:
            for component in parts(path):
                nxt = os.open(component, DIR_FLAGS, dir_fd=fd)
                os.close(fd); fd = nxt
            yield fd
        finally: os.close(fd)

    @contextlib.contextmanager
    def photo(self, path):
        p = parts(path)
        if not p or not PHOTO.search(p[-1]): raise APIError(400)
        with self.directory('/'.join(p[:-1])) as parent:
            fd = os.open(p[-1], FILE_FLAGS, dir_fd=parent)
            try:
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode): raise APIError(400)
                yield fd, st
            finally: os.close(fd)

    def listing(self, path, offset):
        if offset < 0 or offset > 1_000_000: raise APIError(400)
        with self.directory(path) as fd:
            rows = []
            for name in os.listdir(fd):
                try:
                    parts(name)
                    st = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    folder = stat.S_ISDIR(st.st_mode)
                    if not folder and not (stat.S_ISREG(st.st_mode) and PHOTO.search(name)): continue
                    rows.append({'name':name,'path':f'{path}/{name}' if path else name,'dir':folder,'revision':revision(st)})
                except (APIError, OSError): continue
            rows.sort(key=lambda r:(not r['dir'],r['name'].casefold(),r['name']))
            end = offset + 100
            return {'path':path,'total':len(rows),'next':end if end < len(rows) else None,'items':rows[offset:end]}

    def write_check(self):
        if not self.writable: raise APIError(403)

    def upload(self, path, name, stream, length):
        self.write_check()
        if len(parts(name)) != 1 or not PHOTO.search(name): raise APIError(415)
        if length <= 0 or length > MAX_UPLOAD: raise APIError(413)
        with self.lock, self.directory(path) as parent:
            temp = '.our-story-upload-' + uuid.uuid4().hex
            fd = os.open(temp, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                remaining = length; header = b''
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk: raise APIError(400)
                    if len(header) < 64: header += chunk[:64-len(header)]
                    view = memoryview(chunk)
                    while view:
                        written = os.write(fd, view); view = view[written:]
                    remaining -= len(chunk)
                if not photo_magic(name, header): raise APIError(415)
                if Image and name.lower().endswith(('.jpg','.jpeg','.png','.webp','.gif','.bmp')):
                    os.lseek(fd, 0, os.SEEK_SET)
                    with os.fdopen(os.dup(fd), 'rb') as f:
                        try:
                            with Image.open(f) as image: image.verify()
                        except Exception: raise APIError(415)
                os.fchmod(fd, 0o640); os.fsync(fd)
                # Atomic no-clobber publication. Existing names and symlinks are preserved.
                os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
                os.fsync(parent)
            finally:
                os.close(fd)
                os.unlink(temp, dir_fd=parent)
        return {'ok':True}

    @contextlib.contextmanager
    def trash_root(self):
        try: os.mkdir(TRASH, mode=0o700, dir_fd=self.root)
        except FileExistsError: pass
        fd = os.open(TRASH, DIR_FLAGS, dir_fd=self.root)
        try: yield fd
        finally: os.close(fd)

    def trash(self, path, expected):
        self.write_check()
        if not re.fullmatch('[a-f0-9]{64}', expected or ''): raise APIError(400)
        p=parts(path)
        if not p or not PHOTO.search(p[-1]): raise APIError(400)
        with self.lock, self.directory('/'.join(p[:-1])) as parent:
            st=os.stat(p[-1],dir_fd=parent,follow_symlinks=False)
            if not stat.S_ISREG(st.st_mode) or revision(st)!=expected: raise APIError(409)
            with self.trash_root() as root:
                ident=uuid.uuid4().hex; os.mkdir(ident, mode=0o700, dir_fd=root)
                fd=os.open(ident,DIR_FLAGS,dir_fd=root)
                try:
                    data=json.dumps({'id':ident,'path':path,'deletedAt':int(time.time())},ensure_ascii=False).encode()
                    meta=os.open('metadata.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
                    with os.fdopen(meta,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
                    os.rename(p[-1],'photo',src_dir_fd=parent,dst_dir_fd=fd)
                    os.fsync(fd); os.fsync(parent)
                finally: os.close(fd)
        return {'ok':True,'id':ident}

    def read_meta(self, fd):
        meta=os.open('metadata.json',FILE_FLAGS,dir_fd=fd)
        with os.fdopen(meta,'rb') as f:
            if os.fstat(f.fileno()).st_size > 16384: raise APIError(400)
            data=json.load(f)
        parts(data['path'])
        if not PHOTO.search(data['path']): raise APIError(400)
        return data

    def trash_list(self):
        self.write_check()
        with self.lock, self.trash_root() as root:
            rows=[]
            for ident in sorted(os.listdir(root)):
                if not re.fullmatch('[a-f0-9]{32}',ident): continue
                try:
                    fd=os.open(ident,DIR_FLAGS,dir_fd=root)
                    try:
                        data=self.read_meta(fd)
                        if not stat.S_ISREG(os.stat('photo',dir_fd=fd,follow_symlinks=False).st_mode): continue
                        rows.append({**data,'id':ident})
                    finally: os.close(fd)
                except (OSError,APIError,ValueError,KeyError): continue
            return {'items':sorted(rows,key=lambda x:x['deletedAt'],reverse=True)[:1000]}

    def restore(self, ident):
        self.write_check()
        if not re.fullmatch('[a-f0-9]{32}',ident or ''): raise APIError(400)
        with self.lock, self.trash_root() as root:
            fd=os.open(ident,DIR_FLAGS,dir_fd=root)
            try:
                data=self.read_meta(fd); p=parts(data['path'])
                if not stat.S_ISREG(os.stat('photo',dir_fd=fd,follow_symlinks=False).st_mode): raise APIError(400)
                with self.directory('/'.join(p[:-1])) as parent:
                    os.link('photo',p[-1],src_dir_fd=fd,dst_dir_fd=parent,follow_symlinks=False)
                    os.fsync(parent)
                os.unlink('photo',dir_fd=fd); os.unlink('metadata.json',dir_fd=fd)
            finally: os.close(fd)
            os.rmdir(ident,dir_fd=root)
        return {'ok':True}

ALBUM_KEYS = {'home', 'travel', 'growth:다온', 'growth:라온', 'growth:함께'}

def settings_path(value):
    parts(value)
    return value

def album_binding(value):
    if isinstance(value, str): return settings_path(value)
    if not isinstance(value, dict) or set(value) != {'type','text','mode','root'}: raise APIError(400)
    if value['type'] != 'name' or value['mode'] not in ('numbered','exact','contains'): raise APIError(400)
    text=value['text']
    if not isinstance(text,str) or not text.strip() or len(text)>80 or any(ord(c)<32 for c in text) or '/' in text or '\\' in text: raise APIError(400)
    return {**value, 'root':settings_path(value['root'])}

class SharedSettings:
    """Small authenticated family configuration, stored separately from original photos."""
    def __init__(self, root):
        self.root=Path(root)
        self.lock=threading.RLock()
    def read(self):
        with self.lock:
            try:
                with open(self.root/'settings.json', encoding='utf-8') as f: data=json.load(f)
            except FileNotFoundError: return {'revision':0,'albums':{},'home':None}
            return data
    def patch(self, data):
        if not isinstance(data,dict) or set(data)-{'revision','albums','home'}: raise APIError(400)
        if type(data.get('revision')) is not int: raise APIError(400)
        albums=data.get('albums',{})
        if not isinstance(albums,dict) or set(albums)-ALBUM_KEYS: raise APIError(400)
        albums={k:album_binding(v) for k,v in albums.items()}
        home=data.get('home')
        if home is not None:
            if not isinstance(home,dict) or set(home)!={'path','name'}: raise APIError(400)
            settings_path(home['path'])
            if not PHOTO.search(home['path']) or not isinstance(home['name'],str) or len(home['name'])>1024: raise APIError(400)
        with self.lock:
            current=self.read()
            if current['revision']!=data['revision']: raise APIError(409)
            updated={'revision':current['revision']+1,'albums':{**current['albums'],**albums},'home':home if 'home' in data else current['home']}
            temp=self.root/('.settings-'+uuid.uuid4().hex)
            try:
                with open(temp,'x',encoding='utf-8') as f:
                    os.chmod(temp,0o600)
                    json.dump(updated,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
                os.replace(temp,self.root/'settings.json')
                fd=os.open(self.root,DIR_FLAGS)
                try: os.fsync(fd)
                finally: os.close(fd)
            finally:
                if temp.exists(): temp.unlink()
            return updated

class SharedArchive:
    """Persistent, deterministic family photo index. Originals are always read-only here."""
    def __init__(self, settings, store):
        self.root=settings.root
        self.store=store
        self.lock=threading.RLock()
        self.cache_lock=threading.Lock()
        self.root.mkdir(parents=True,exist_ok=True)
    def connect(self):
        db=sqlite3.connect(self.root/'archive.sqlite3',timeout=10)
        os.chmod(self.root/'archive.sqlite3',0o600)
        db.executescript("""
                CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS photos (collection TEXT, generation INTEGER, path TEXT,
                    name TEXT, revision TEXT, year TEXT, folder TEXT,
                    PRIMARY KEY(collection,generation,path));
                CREATE INDEX IF NOT EXISTS photo_order ON photos(collection,generation,year DESC,path);
            """)
        return db
    @staticmethod
    def year(path):
        return next((p[:4] for p in path.split('/') if re.fullmatch(r'(19|20)[0-9]{2}년?',p)),'')
    @staticmethod
    def matches(name, rule):
        name=unicodedata.normalize('NFC',name).strip().casefold()
        text=unicodedata.normalize('NFC',rule['text']).strip().casefold()
        return (text in name if rule['mode']=='contains' else name==text or
                (rule['mode']=='numbered' and name.startswith(text) and bool(re.fullmatch(r'\s*[0-9]+',name[len(text):]))))
    def collection(self, key, binding, year='', refresh=False, budget=20):
        ident=hashlib.sha256(json.dumps([key,binding],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        named=isinstance(binding,dict)
        root=binding['root'] if named else binding
        with self.lock, contextlib.closing(self.connect()) as db, db:
            row=db.execute('SELECT state FROM collections WHERE id=?',(ident,)).fetchone()
            state=json.loads(row[0]) if row else {'active':None,'generation':0,'queue':[],'updated':0}
            if not state['queue'] and (not state['generation'] or refresh or time.time()-state['updated']>300):
                state.update(generation=state['generation']+1,issues=0,matches=[],scanned=0,updated=time.time())
                include=not named or bool(root and self.matches(root.split('/')[-1],binding))
                state['queue']=[[root,0,include,root if include and named else '',0]]
                if include and named: state['matches']=[{'path':root,'name':root.split('/')[-1],'year':self.year(root)}]
            started=time.monotonic()
            for _ in range(budget):
                if not state['queue'] or time.monotonic()-started>1.5: break
                path,depth,include,folder,offset=state['queue'].pop(0)
                state['scanned']=state.get('scanned',0)+1
                try: data=self.store.listing(path,offset)
                except (OSError,APIError): state['issues']+=1; continue
                for item in data['items']:
                    if item['dir']:
                        if depth>=32 or len(state['queue'])>=10000:
                            state['issues']+=1; continue
                        match=named and not include and self.matches(item['name'],binding)
                        child_folder=item['path'] if match else folder
                        if match:
                            if len(state['matches'])<5000:
                                state['matches'].append({'path':item['path'],'name':item['name'],'year':self.year(item['path'])})
                            else: state['issues']+=1
                        state['queue'].append([item['path'],depth+1,include or match,child_folder,0])
                    elif include:
                        db.execute('INSERT OR REPLACE INTO photos VALUES (?,?,?,?,?,?,?)',
                            (ident,state['generation'],item['path'],item['name'],item['revision'],self.year(item['path']),folder))
                if data['next'] is not None: state['queue'].append([path,depth,include,folder,data['next']])
            if not state['queue']:
                # A complete traversal with unreadable folders must not erase a known-good snapshot.
                if not state['issues'] or state['active'] is None:
                    state['active']=state['generation']
                    state['activeMatches']=state['matches']
                state['updated']=time.time()
                db.execute('DELETE FROM photos WHERE collection=? AND generation NOT IN (?,?)',
                    (ident,state['active'],state['generation']))
            db.execute('INSERT OR REPLACE INTO collections VALUES (?,?)',(ident,json.dumps(state,ensure_ascii=False)))
            generation=state['active'] if state['active'] is not None else state['generation']
            args=[ident,generation]
            where='collection=? AND generation=?'
            if year:
                where+=' AND year=?';args.append('' if year=='other' else year)
            total=db.execute('SELECT count(*) FROM photos WHERE '+where,args).fetchone()[0]
            rows=db.execute('SELECT path,name,revision,year,folder FROM photos WHERE '+where+' ORDER BY year DESC,path COLLATE BINARY LIMIT 12',args).fetchall()
            matches=sorted(state.get('activeMatches',[]) if state['active'] is not None else state.get('matches',[]),key=lambda m:(m['year'],m['path']),reverse=True)
            return {'items':[{'path':p,'name':n,'revision':r,'dir':False,'folderYear':y,'albumFolder':f} for p,n,r,y,f in rows],
                'matchedFolders':matches,'selectedYear':year,'rule':binding if named else None,'path':root,
                'total':total,'limited':total>12,'issues':state['issues'],'indexing':bool(state['queue']),
                'shared':True,'snapshot':generation,'progress':{'scanned':state.get('scanned',0),'pending':len(state['queue']),'found':db.execute('SELECT count(*) FROM photos WHERE collection=? AND generation=?',(ident,state['generation'])).fetchone()[0]},'search':{'limited':False,'canContinue':False,'folders':len(matches)}}
    def thumbnail(self, fd, st):
        # Revision changes on source edits, so stale thumbnails are never reused.
        cache=self.root/'thumbnails';cache.mkdir(mode=0o700,exist_ok=True)
        key='v1-'+revision(st)+'.jpg';target=cache/key
        with self.cache_lock:
            try:
                raw=target.read_bytes();os.utime(target,None);return raw
            except FileNotFoundError: pass
            with os.fdopen(os.dup(fd),'rb') as source:
                with Image.open(source) as image:
                    image.thumbnail((1600,1600))
                    image=ImageOps.exif_transpose(image).convert('RGB')
                    out=io.BytesIO();image.save(out,format='JPEG',quality=80);raw=out.getvalue()
            temp=cache/('.'+uuid.uuid4().hex)
            try:
                with open(temp,'xb') as f:
                    os.chmod(temp,0o600);f.write(raw)
                os.replace(temp,target)
            finally:
                temp.unlink(missing_ok=True)
            # Bound persistent cache to 512 MiB, evict least recently requested thumbnails.
            files=[(p.stat().st_mtime,p.stat().st_size,p) for p in cache.glob('v1-*.jpg')]
            size=sum(n for _,n,_ in files)
            for _,n,p in sorted(files):
                if size<=512*1024*1024: break
                p.unlink(missing_ok=True);size-=n
            return raw

class Handler(BaseHTTPRequestHandler):
    server_version='OurStoryNAS/2'
    def setup(self):
        super().setup(); self.connection.settimeout(120)
    def log_message(self, *args): pass  # No paths, credentials, or private metadata in logs.
    def cors(self):
        self.send_header('Access-Control-Allow-Origin',self.server.origin)
        self.send_header('Vary','Origin')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'none'; sandbox")
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status); self.cors(); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def authorized(self):
        if self.headers.get('Origin')!=self.server.origin: raise APIError(403)
        value=self.headers.get('Authorization','')
        if not hmac.compare_digest(value.encode(),('Bearer '+self.server.token).encode()): raise APIError(401)
    def do_OPTIONS(self):
        if self.headers.get('Origin')!=self.server.origin: self.reply(403,{'error':'forbidden'}); return
        self.send_response(204); self.cors(); self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS'); self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type'); self.end_headers()
    def do_GET(self): self.run_request(False)
    def do_POST(self): self.run_request(True)
    def run_request(self,post):
        try:
            self.authorized()
            route=urlsplit(self.path); query=parse_qs(route.query,keep_blank_values=True,strict_parsing=True)
            if any(len(v)!=1 for v in query.values()): raise APIError(400)
            q=lambda k,default='':query.get(k,[default])[0]
            store=self.server.store
            if not post:
                if route.path=='/api/capabilities': self.reply(200,{'version':2,'thumbnails':bool(Image),'upload':store.writable,'trash':store.writable,'download':True,'maxUpload':MAX_UPLOAD,'sharedSettings':self.server.settings is not None,'sharedArchive':self.server.archive is not None}); return
                if route.path=='/api/settings' and self.server.settings is not None: self.reply(200,self.server.settings.read()); return
                if route.path=='/api/list': self.reply(200,store.listing(q('path'),int(q('offset','0')))); return
                if route.path=='/api/trash': self.reply(200,store.trash_list()); return
                if route.path in ('/api/image','/api/download','/api/thumbnail'):
                    self.send_photo(q('path'),route.path); return
            else:
                if self.headers.get('Transfer-Encoding'): raise APIError(400)
                length=int(self.headers.get('Content-Length','0'))
                if route.path=='/api/album-index' and self.server.archive is not None:
                    if length<=0 or length>1024 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict) or set(data)-{'key','year','refresh'}: raise APIError(400)
                    key=data.get('key');year=data.get('year','');refresh=data.get('refresh',False)
                    if not isinstance(key,str) or key not in ALBUM_KEYS or not isinstance(year,str) or (year and year!='other' and not re.fullmatch(r'(19|20)[0-9]{2}',year)) or type(refresh) is not bool: raise APIError(400)
                    settings=self.server.settings.read()
                    if key!='home' and key not in settings['albums']:
                        self.reply(200,{'items':[],'unbound':True,'shared':True});return
                    binding=album_binding(settings['albums'].get(key,''))
                    self.reply(200,self.server.archive.collection(key,binding,year,refresh));return
                if route.path=='/api/settings' and self.server.settings is not None:
                    if length<=0 or length>32768 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    self.reply(200,self.server.settings.patch(json.loads(self.rfile.read(length)))); return
                if route.path=='/api/upload':
                    if self.headers.get_content_type()!='application/octet-stream': raise APIError(415)
                    self.reply(201,store.upload(q('path'),q('name'),self.rfile,length)); return
                if route.path in ('/api/trash','/api/restore'):
                    if length<=0 or length>16384 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict): raise APIError(400)
                    result=store.trash(data.get('path'),data.get('revision')) if route.path=='/api/trash' else store.restore(data.get('id'))
                    self.reply(200,result); return
            raise APIError(404)
        except APIError as e: self.reply(e.status,{'error':'request_rejected'})
        except FileExistsError: self.reply(409,{'error':'name_conflict'})
        except FileNotFoundError: self.reply(404,{'error':'not_found'})
        except PermissionError: self.reply(403,{'error':'permission_denied'})
        except (ValueError,TypeError,KeyError): self.reply(400,{'error':'invalid_request'})
        except (BrokenPipeError,ConnectionResetError,TimeoutError): pass
        except OSError: self.reply(400,{'error':'filesystem_request_rejected'})
        except Exception: self.reply(500,{'error':'internal_error'})
    def send_photo(self,path,route):
        store=self.server.store
        with store.photo(path) as (fd,st):
            limit=MAX_DOWNLOAD if route=='/api/download' else 15*1024*1024
            mime=mimetypes.guess_type(path)[0] or {'heic':'image/heic','heif':'image/heif','avif':'image/avif'}.get(path.rsplit('.',1)[-1].lower(),'application/octet-stream')
            if route=='/api/thumbnail':
                if not Image: raise APIError(404)
                if st.st_size>MAX_DOWNLOAD: raise APIError(413)
                if not store.image_slots.acquire(blocking=False): raise APIError(429)
                try:
                    if self.server.archive is not None:
                        raw=self.server.archive.thumbnail(fd,st)
                    else:
                      with os.fdopen(os.dup(fd),'rb') as source:
                        with Image.open(source) as image:
                            image.thumbnail((1600,1600))
                            image=ImageOps.exif_transpose(image).convert('RGB')
                            out=io.BytesIO(); image.save(out,format='JPEG',quality=80)
                      raw=out.getvalue()
                except Exception: raise APIError(415)
                finally: store.image_slots.release()
                self.send_response(200); self.cors(); self.send_header('Content-Type','image/jpeg'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw); return
            if st.st_size>limit: raise APIError(413)
            self.send_response(200); self.cors(); self.send_header('Content-Type',mime); self.send_header('Content-Length',str(st.st_size))
            if route=='/api/download': self.send_header('Content-Disposition',"attachment; filename=photo; filename*=UTF-8''"+quote(path.split('/')[-1]))
            self.end_headers()
            remaining=st.st_size
            while remaining:
                data=os.read(fd,min(65536,remaining))
                if not data: break
                self.wfile.write(data); remaining-=len(data)

class Server(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=8
    def __init__(self,address,store,token,origin,settings=None):
        if not re.fullmatch(r'[!-~]{32,512}',token): raise ValueError('NAS_TOKEN must contain 32–512 printable ASCII characters')
        self.store=store; self.token=token; self.origin=origin; self.settings=settings
        self.archive=SharedArchive(settings,store) if settings is not None else None
        self.slots=threading.BoundedSemaphore(8)
        super().__init__(address,Handler)
    def process_request(self,request,client_address):
        if not self.slots.acquire(blocking=False): request.close(); return
        try: super().process_request(request,client_address)
        except Exception: self.slots.release(); raise
    def process_request_thread(self,request,client_address):
        try: super().process_request_thread(request,client_address)
        finally: self.slots.release()

if __name__=='__main__':
    store=PhotoStore(os.environ.get('PHOTO_ROOT','/photos'),os.environ.get('ENABLE_WRITES')=='1')
    server=Server(('0.0.0.0',8000),store,os.environ.get('NAS_TOKEN',''),os.environ.get('ALLOWED_ORIGIN','https://mashimaru7-max.github.io'),SharedSettings(os.environ.get('SETTINGS_ROOT','/settings')))
    print('Our Story NAS v2: '+('write enabled' if store.writable else 'read-only'),flush=True)
    server.serve_forever()
