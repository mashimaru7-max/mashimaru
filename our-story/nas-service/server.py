"""Separate NAS photo service. Never modifies the existing nas-photo-test service.
Linux only: descriptor-relative paths, no symlink traversal, read-only by default.
"""
import contextlib
import datetime
import ctypes
import errno
import math
import tempfile
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
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
    if any(not p or p.startswith(('.', '@')) or p.casefold() in ('#recycle','#snapshot') for p in values): raise APIError(400)
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
                    data=json.dumps({'id':ident,'path':path,'deletedAt':int(time.time()),'originalRevision':expected,'identity':[st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]},ensure_ascii=False).encode()
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
    def collection(self, key, binding, year='', refresh=False, budget=20, seed=''):
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
            if seed:
                db.create_function('visit_rank',1,lambda path:hashlib.sha256((seed+'\0'+path).encode()).hexdigest(),deterministic=True)
            order='visit_rank(path),path' if seed else 'year DESC,path COLLATE BINARY'
            rows=db.execute('SELECT path,name,revision,year,folder FROM photos WHERE '+where+' ORDER BY '+order+' LIMIT 12',args).fetchall()
            matches=sorted(state.get('activeMatches',[]) if state['active'] is not None else state.get('matches',[]),key=lambda m:(m['year'],m['path']),reverse=True)
            return {'items':[{'path':p,'name':n,'revision':r,'dir':False,'folderYear':y,'albumFolder':f} for p,n,r,y,f in rows],
                'matchedFolders':matches,'selectedYear':year,'rule':binding if named else None,'path':root,
                'total':total,'limited':total>12,'issues':state['issues'],'indexing':bool(state['queue']),
                'shared':True,'randomized':bool(seed),'snapshot':generation,'progress':{'scanned':state.get('scanned',0),'pending':len(state['queue']),'found':db.execute('SELECT count(*) FROM photos WHERE collection=? AND generation=?',(ident,state['generation'])).fetchone()[0]},'search':{'limited':False,'canContinue':False,'folders':len(matches)}}
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

class FamilyAuth:
    USERNAME='오니둥이'
    SESSION_SECONDS=30*86400
    def __init__(self, root):
        self.path=Path(root)/'auth.sqlite3'
        self.lock=threading.RLock()
        self.hash_slot=threading.BoundedSemaphore(1)
    @contextlib.contextmanager
    def db(self):
        with self.lock, contextlib.closing(sqlite3.connect(self.path,timeout=10)) as db, db:
            os.chmod(self.path,0o600)
            db.executescript("""
                CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1),username TEXT,salt BLOB,digest BLOB);
                CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY,expires REAL,created REAL);
                CREATE TABLE IF NOT EXISTS failures (at REAL);
            """)
            yield db
    def configured(self):
        if not self.path.exists(): return False
        with self.db() as db: return db.execute('SELECT 1 FROM account WHERE id=1').fetchone() is not None
    @staticmethod
    def password(value):
        if not isinstance(value,str) or not 10<=len(value)<=128: raise APIError(400)
        return value.encode('utf-8')
    @staticmethod
    def derive(password,salt):
        return hashlib.scrypt(password,salt=salt,n=131072,r=8,p=1,dklen=32,maxmem=256*1024*1024)
    def setup(self,data):
        if not isinstance(data,dict) or set(data)!={'username','password'} or data['username']!=self.USERNAME: raise APIError(400)
        password=self.password(data['password'])
        if not self.hash_slot.acquire(blocking=False): raise APIError(429)
        try:
            with self.db() as db:
                if db.execute('SELECT 1 FROM account WHERE id=1').fetchone(): raise APIError(409)
                salt=secrets.token_bytes(16)
                db.execute('INSERT INTO account VALUES (1,?,?,?)',(self.USERNAME,salt,self.derive(password,salt)))
        finally: self.hash_slot.release()
    def login(self,data):
        if not isinstance(data,dict) or set(data)!={'username','password'}: raise APIError(400)
        username=data['username'];password=data['password']
        if not isinstance(username,str) or len(username)>80 or not isinstance(password,str) or len(password)>128: raise APIError(400)
        if not self.hash_slot.acquire(blocking=False): raise APIError(429)
        try:
            with self.db() as db:
                now=time.time();db.execute('DELETE FROM failures WHERE at<?',(now-60,))
                if db.execute('SELECT count(*) FROM failures').fetchone()[0]>=10: raise APIError(429)
                row=db.execute('SELECT username,salt,digest FROM account WHERE id=1').fetchone()
                if not row: raise APIError(409)
                actual=self.derive(password.encode('utf-8'),row[1])
                good=hmac.compare_digest(unicodedata.normalize('NFC',username).encode(),row[0].encode()) & hmac.compare_digest(actual,row[2])
                if not good:
                    db.execute('INSERT INTO failures VALUES (?)',(now,))
                    # Commit failed attempts before returning an authentication error.
                    db.commit();raise APIError(401)
                session=secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<=?',(now,))
                db.execute('DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions ORDER BY created DESC LIMIT -1 OFFSET 19)')
                db.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(session.encode()).hexdigest(),now+self.SESSION_SECONDS,now))
                return {'session':session,'expiresIn':self.SESSION_SECONDS}
        finally: self.hash_slot.release()
    def valid(self,secret):
        if not isinstance(secret,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',secret): return False
        with self.db() as db:
            return db.execute('SELECT 1 FROM sessions WHERE digest=? AND expires>?',(hashlib.sha256(secret.encode()).hexdigest(),time.time())).fetchone() is not None
    def logout(self,secret):
        with self.db() as db: db.execute('DELETE FROM sessions WHERE digest=?',(hashlib.sha256(secret.encode()).hexdigest(),))

class JournalStore:
    """Family records only. This database never contains photo binaries or credentials."""
    KINDS={'diary','words','letter','measure'}
    TARGETS={'다온','라온','함께'}
    AUTHORS={'엄마','아빠','엄마와 아빠','가족'}
    def __init__(self,root,photos):
        self.root=Path(root);self.photos=photos;self.lock=threading.RLock()
    @contextlib.contextmanager
    def db(self):
        with self.lock, contextlib.closing(sqlite3.connect(self.root/'journal.sqlite3',timeout=10)) as db:
            os.chmod(self.root/'journal.sqlite3',0o600)
            db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,revision INTEGER,payload TEXT,deleted INTEGER,created TEXT,updated TEXT)')
            db.commit()
            with db: yield db
    @staticmethod
    def text(value,maximum,required=False):
        if not isinstance(value,str) or len(value)>maximum or '\x00' in value or (required and not value.strip()): raise APIError(400)
        return value.strip()
    @staticmethod
    def date(value,optional=False):
        if optional and value=='': return ''
        if not isinstance(value,str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',value): raise APIError(400)
        datetime.date.fromisoformat(value)
        return value
    @staticmethod
    def ident(value):
        if not isinstance(value,str) or str(uuid.UUID(value))!=value: raise APIError(400)
        return value
    def validate(self,value):
        if not isinstance(value,dict): raise APIError(400)
        target=value.get('target');kind=value.get('kind');author=value.get('author')
        if not isinstance(target,str) or target not in self.TARGETS or not isinstance(kind,str) or kind not in self.KINDS or not isinstance(author,str) or author not in self.AUTHORS: raise APIError(400)
        fields={'diary':{'title','topic','body','feeling'},'words':{'quote','listener','context'},'letter':{'body','readOn'},'measure':{'height','weight','note'}}[kind]
        if set(value)-({'target','kind','date','author','attachments'}|fields): raise APIError(400)
        out={'target':target,'kind':kind,'date':self.date(value.get('date')),'author':author}
        if kind=='diary':
            for key,limit,required in [('title',100,True),('topic',40,True),('body',6000,True),('feeling',2000,False)]:out[key]=self.text(value.get(key,''),limit,required)
        elif kind=='words':
            for key,limit,required in [('quote',1000,True),('listener',100,False),('context',3000,False)]:out[key]=self.text(value.get(key,''),limit,required)
        elif kind=='letter':
            out['body']=self.text(value.get('body'),10000,True);out['readOn']=self.date(value.get('readOn',''),True)
        else:
            for key,low,high in [('height',20,250),('weight',1,200)]:
                number=value.get(key)
                if number is not None and (type(number) not in (int,float) or not math.isfinite(number) or not low<=number<=high): raise APIError(400)
                out[key]=number
            if out['height'] is None and out['weight'] is None: raise APIError(400)
            out['note']=self.text(value.get('note',''),1000)
        refs=value.get('attachments',[])
        if not isinstance(refs,list) or len(refs)>6: raise APIError(400)
        out['attachments']=[];seen=set()
        for ref in refs:
            if not isinstance(ref,dict) or set(ref)!={'path','revision'}: raise APIError(400)
            path=ref['path'];rev=ref['revision']
            if not isinstance(path,str) or len(path)>1024 or path in seen or not isinstance(rev,str) or not re.fullmatch(r'[a-f0-9]{64}',rev): raise APIError(400)
            with self.photos.photo(path) as (fd,st):
                if rev!=revision(st): raise APIError(409)
            seen.add(path);out['attachments'].append({'path':path,'revision':rev})
        return out
    @staticmethod
    def unpack(row):
        return {'id':row[0],'revision':row[1],'record':json.loads(row[2]),'deleted':bool(row[3]),'createdAt':row[4],'updatedAt':row[5]}
    def get(self,ident):
        ident=self.ident(ident)
        with self.db() as db:
            row=db.execute('SELECT * FROM records WHERE id=?',(ident,)).fetchone()
            if row is None: raise APIError(404)
            return self.unpack(row)
    def listing(self,target,kind='',year='',query='',trash=False,offset=0):
        if target not in self.TARGETS or (kind and kind not in self.KINDS) or (year and not re.fullmatch(r'[0-9]{4}',year)) or len(query)>100 or offset<0 or offset>1000000: raise APIError(400)
        with self.db() as db:
            where='deleted=? AND json_extract(payload,\'$.target\')=?';args=[int(trash),target]
            years=[r[0] for r in db.execute('SELECT DISTINCT substr(json_extract(payload,\'$.date\'),1,4) FROM records WHERE '+where+' ORDER BY 1 DESC',args)]
            if kind:where+=' AND json_extract(payload,\'$.kind\')=?';args.append(kind)
            if year:where+=' AND substr(json_extract(payload,\'$.date\'),1,4)=?';args.append(year)
            if query:
                # instr uses literal text; wildcard characters never change the query scope.
                where+=' AND instr(lower(payload),lower(?))>0';args.append(query)
            total=db.execute('SELECT count(*) FROM records WHERE '+where,args).fetchone()[0]
            rows=db.execute('SELECT * FROM records WHERE '+where+' ORDER BY json_extract(payload,\'$.date\') DESC,id DESC LIMIT 10 OFFSET ?',args+[offset]).fetchall()
            end=offset+len(rows)
            return {'items':[self.unpack(r) for r in rows],'total':total,'next':end if end<total else None,'years':years}
    def mutate(self,data):
        if not isinstance(data,dict) or set(data)-{'action','id','revision','record'}: raise APIError(400)
        action=data.get('action');ident=self.ident(data.get('id'));expected=data.get('revision')
        if action not in ('save','trash','restore') or type(expected) is not int or expected<0: raise APIError(400)
        record=self.validate(data.get('record')) if action=='save' else None
        if action!='save' and 'record' in data: raise APIError(400)
        now=datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM records WHERE id=?',(ident,)).fetchone()
            if row is None:
                if action!='save' or expected!=0: raise APIError(404)
                db.execute('INSERT INTO records VALUES (?,?,?,?,?,?)',(ident,1,json.dumps(record,ensure_ascii=False),0,now,now))
            else:
                if action=='save' and expected==0 and row[1]==1 and not row[3] and json.loads(row[2])==record:return self.unpack(row)
                if row[1]!=expected or (action=='restore')!=bool(row[3]): raise APIError(409)
                if action=='save':
                    previous=json.loads(row[2])
                    if record['target']!=previous['target'] or record['kind']!=previous['kind']: raise APIError(400)
                payload=json.dumps(record,ensure_ascii=False) if action=='save' else row[2]
                db.execute('UPDATE records SET revision=?,payload=?,deleted=?,updated=? WHERE id=?',(expected+1,payload,int(action=='trash'),now,ident))
            return self.unpack(db.execute('SELECT * FROM records WHERE id=?',(ident,)).fetchone())
    def backup(self):
        fd,path=tempfile.mkstemp(prefix='.journal-backup-',suffix='.sqlite3',dir=self.root);os.close(fd)
        try:
            with self.db() as source, contextlib.closing(sqlite3.connect(path)) as dest:source.backup(dest)
            return Path(path)
        except Exception:
            Path(path).unlink(missing_ok=True);raise

def rename_no_replace(src_fd,src_name,dst_fd,dst_name):
    """Atomic no-clobber rename. Unsupported NAS kernels fail without a fallback."""
    libc=ctypes.CDLL(None,use_errno=True)
    call=getattr(libc,'renameat2',None)
    if call is None: raise APIError(501)
    call.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];call.restype=ctypes.c_int
    if call(src_fd,os.fsencode(src_name),dst_fd,os.fsencode(dst_name),1)!=0:
        code=ctypes.get_errno()
        if code in (errno.EEXIST,errno.ENOTEMPTY): raise APIError(409)
        if code in (errno.ENOSYS,errno.EOPNOTSUPP,errno.EINVAL,errno.EXDEV): raise APIError(501)
        raise OSError(code,os.strerror(code))

class FileManager:
    """Recoverable moves, metadata rewrites and derived-index invalidation."""
    def __init__(self,store,settings,journal,archive):
        self.store=store;self.settings=settings;self.journal=journal;self.archive=archive
        self.path=settings.root/'file-operations.sqlite3';self.lock=threading.RLock();self.blocked=False
    @contextlib.contextmanager
    def db(self):
        with self.lock, contextlib.closing(sqlite3.connect(self.path,timeout=10)) as db,db:
            os.chmod(self.path,0o600)
            db.execute('CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,status TEXT,payload TEXT)')
            yield db
    def safe_moves(self):
        if not self.store.writable:return False
        if getattr(self,'atomic_supported',None) is not None:return self.atomic_supported
        probe='.probe-'+uuid.uuid4().hex
        try:
            with self.store.lock,self.store.trash_root() as root:
                os.mkdir(probe,mode=0o700,dir_fd=root);fd=os.open(probe,DIR_FLAGS,dir_fd=root)
                try:
                    os.mkdir('source',mode=0o700,dir_fd=fd);os.mkdir('existing',mode=0o700,dir_fd=fd)
                    try:rename_no_replace(fd,'source',fd,'existing')
                    except APIError as error:
                        if error.status!=409:raise
                    else:raise APIError(501)
                    rename_no_replace(fd,'source',fd,'destination')
                    os.fsync(fd);os.fsync(root)
                    self.atomic_supported=True;self.atomic_error=None;return True
                finally:
                    for name in ('source','existing','destination'):
                        try:os.rmdir(name,dir_fd=fd)
                        except FileNotFoundError:pass
                    os.close(fd);os.rmdir(probe,dir_fd=root)
        except APIError:
            self.atomic_supported=False;self.atomic_error=501;return False
        except OSError as error:
            self.atomic_error=403 if error.errno in (errno.EROFS,errno.EACCES,errno.EPERM) else 501 if error.errno in (errno.EINVAL,errno.ENOSYS,errno.EOPNOTSUPP) else 503
            return False
    @staticmethod
    def mapped(path,old,new):
        return new+path[len(old):] if path==old or path.startswith(old+'/') else path
    @staticmethod
    def identity(st):return [st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]
    @contextlib.contextmanager
    def source(self,plan):
        if plan['kind']=='restore':
            with self.store.trash_root() as root:
                fd=os.open(plan['trashId'],DIR_FLAGS,dir_fd=root)
                try:yield fd,'photo'
                finally:os.close(fd)
        else:
            p=parts(plan['old'])
            with self.store.directory('/'.join(p[:-1])) as fd:yield fd,p[-1]
    def write_op(self,ident,status,plan):
        with self.db() as db:db.execute('INSERT OR REPLACE INTO operations VALUES (?,?,?)',(ident,status,json.dumps(plan,ensure_ascii=False)))
    @staticmethod
    def compact(plan):
        return {k:v for k,v in plan.items() if k in ('kind','old','new','request','trashId')}|{'linkedRecords':len(plan.get('records',[]))}
    def invalidate(self):
        if not (self.settings.root/'archive.sqlite3').exists():return
        with self.archive.lock, contextlib.closing(self.archive.connect()) as db,db:
            db.execute('DELETE FROM photos');db.execute('DELETE FROM collections')
    def snapshot(self,old,new,restore_meta=None):
        before=self.settings.read();after=json.loads(json.dumps(before));records=[];size=0
        if restore_meta is None:
            for key,binding in after['albums'].items():
                if isinstance(binding,str):after['albums'][key]=self.mapped(binding,old,new)
                else:binding['root']=self.mapped(binding['root'],old,new)
            if after['home']:
                previous=after['home']['path'];after['home']['path']=self.mapped(previous,old,new)
                if after['home']['name']==previous.split('/')[-1]:after['home']['name']=after['home']['path'].split('/')[-1]
        for binding in after['albums'].values():album_binding(binding)
        if after['home']:settings_path(after['home']['path'])
        setting_plan=None
        if after!=before:
            after['revision']=before['revision']+1;setting_plan={'before':before,'after':after}
        if (self.settings.root/'journal.sqlite3').exists():
            with self.journal.db() as db:
                for row in db.execute('SELECT * FROM records'):
                    payload=json.loads(row[2]);refs=[];changed=False
                    for index,ref in enumerate(payload.get('attachments',[])):
                        if restore_meta is not None:
                            affected=ref['path']==old and ref['revision']==restore_meta.get('originalRevision')
                        else:affected=ref['path']==old or ref['path'].startswith(old+'/')
                        if not affected:continue
                        identity=None
                        if restore_meta is not None:identity=restore_meta.get('identity')
                        else:
                            try:
                                with self.store.photo(ref['path']) as (fd,st):
                                    if revision(st)==ref['revision']:identity=self.identity(st)
                            except (OSError,APIError):pass
                        ref['path']=self.mapped(ref['path'],old,new)
                        parts(ref['path'])
                        if len(ref['path'])>1024:raise APIError(400)
                        refs.append({'index':index,'identity':identity});changed=True
                    if changed:
                        size+=len(row[2].encode())
                        if len(records)>=1000 or size>16*1024*1024:raise APIError(413)
                        records.append({'id':row[0],'revision':row[1],'beforeHash':hashlib.sha256(row[2].encode()).hexdigest(),'deleted':row[3],'record':payload,'refs':refs})
        return setting_plan,records
    def finalize(self,ident,plan):
        with self.source(plan) as (fd,name):os.fsync(fd)
        p=parts(plan['new'])
        with self.store.directory('/'.join(p[:-1])) as fd:os.fsync(fd)
        # Store resolved metadata before applying it, so replay is idempotent.
        if not plan.get('resolved'):
            for item in plan['records']:
                for state in item['refs']:
                    ref=item['record']['attachments'][state['index']]
                    if state['identity'] is None:continue
                    try:
                        with self.store.photo(ref['path']) as (fd,st):
                            if self.identity(st)==state['identity']:ref['revision']=revision(st)
                    except (OSError,APIError):pass
                item['payload']=json.dumps(item.pop('record'),ensure_ascii=False)
            plan['resolved']=True;self.write_op(ident,'moved',plan)
        change=plan['settings']
        if change:
            current=self.settings.read()
            if current==change['before']:
                after=change['after'];self.settings.patch({'revision':current['revision'],'albums':after['albums'],'home':after['home']})
            elif current!=change['after']:raise APIError(503)
        if plan['records']:
            with self.journal.db() as db:
                db.execute('BEGIN IMMEDIATE')
                for item in plan['records']:
                    row=db.execute('SELECT revision,payload,deleted FROM records WHERE id=?',(item['id'],)).fetchone()
                    if row and row[0]==item['revision']+1 and row[1]==item['payload'] and row[2]==item['deleted']:continue
                    if not row or row[0]!=item['revision'] or hashlib.sha256(row[1].encode()).hexdigest()!=item['beforeHash'] or row[2]!=item['deleted']:raise APIError(503)
                    db.execute('UPDATE records SET revision=?,payload=?,updated=? WHERE id=?',(item['revision']+1,item['payload'],plan['at'],item['id']))
        self.invalidate();self.write_op(ident,'done',self.compact(plan))
        if plan['kind']=='restore':
            try:
                with self.store.trash_root() as root:
                    fd=os.open(plan['trashId'],DIR_FLAGS,dir_fd=root)
                    try:os.unlink('metadata.json',dir_fd=fd)
                    finally:os.close(fd)
                    os.rmdir(plan['trashId'],dir_fd=root)
            except OSError:pass # An empty private metadata entry may remain after a crash.
    def recover(self):
        if not self.path.exists():self.blocked=False;return
        try:
            with self.db() as db:pending=[r[0] for r in db.execute("SELECT id FROM operations WHERE status IN ('prepared','moved')")]
            for ident in pending:
                with self.db() as db:status,raw=db.execute('SELECT status,payload FROM operations WHERE id=?',(ident,)).fetchone()
                plan=json.loads(raw)
                if status=='prepared':
                    try:
                        with self.source(plan) as (fd,name):src=os.stat(name,dir_fd=fd,follow_symlinks=False)
                    except FileNotFoundError:src=None
                    dstparts=parts(plan['new'])
                    try:
                        with self.store.directory('/'.join(dstparts[:-1])) as fd:dst=os.stat(dstparts[-1],dir_fd=fd,follow_symlinks=False)
                    except FileNotFoundError:dst=None
                    if src is not None:
                        if [src.st_dev,src.st_ino]==plan['inode']:
                            self.write_op(ident,'cancelled',self.compact(plan));continue
                        if dst is None or [dst.st_dev,dst.st_ino]!=plan['inode']:raise APIError(503)
                    if dst is None or [dst.st_dev,dst.st_ino]!=plan['inode']:raise APIError(503)
                self.finalize(ident,plan)
            self.blocked=False
        except Exception:
            self.blocked=True;raise APIError(503)
    def execute(self,ident,plan):
        self.write_op(ident,'prepared',plan)
        p=parts(plan['new'])
        try:
            with self.source(plan) as (src,name),self.store.directory('/'.join(p[:-1])) as dst:
                st=os.stat(name,dir_fd=src,follow_symlinks=False)
                if revision(st)!=plan['sourceRevision']:raise APIError(409)
                rename_no_replace(src,name,dst,p[-1]);os.fsync(src);os.fsync(dst)
                moved=os.stat(p[-1],dir_fd=dst,follow_symlinks=False)
                if [moved.st_dev,moved.st_ino]!=plan['inode']:raise APIError(503)
            self.finalize(ident,plan)
        except Exception:
            # Recovery either completes the recorded move or cancels an unstarted one.
            self.recover()
            with self.db() as db:state=db.execute('SELECT status FROM operations WHERE id=?',(ident,)).fetchone()
            if not state or state[0]!='done':raise
        return {'ok':True,'path':plan['new'],'linkedRecords':len(plan['records'])}
    def perform(self,data):
        self.store.write_check()
        if not isinstance(data,dict):raise APIError(400)
        if data.get('action')=='mkdir':
            if set(data)!={'action','parent','name'}:raise APIError(400)
            parent=data['parent'];name=data['name'];parts(parent)
            if len(parts(name))!=1:raise APIError(400)
            with self.store.lock,self.store.directory(parent) as fd:
                os.mkdir(name,mode=0o750,dir_fd=fd);os.fsync(fd)
            self.invalidate();return {'ok':True,'path':parent+'/'+name if parent else name}
        if set(data)!={'action','path','revision','destination','name','operationId'} or data['action']!='move':raise APIError(400)
        old=data['path'];destination=data['destination'];name=data['name'];ident=data['operationId']
        if not isinstance(ident,str) or not re.fullmatch(r'[a-f0-9]{32}',ident):raise APIError(400)
        p=parts(old);parts(destination)
        if not p or len(parts(name))!=1 or not isinstance(data['revision'],str) or not re.fullmatch(r'[a-f0-9]{64}',data['revision']):raise APIError(400)
        new=destination+'/'+name if destination else name
        if new==old or new.startswith(old+'/'):raise APIError(400)
        with self.db() as db:existing=db.execute('SELECT status,payload FROM operations WHERE id=?',(ident,)).fetchone()
        if existing:
            plan=json.loads(existing[1])
            if plan.get('request')!=data:raise APIError(409)
            if existing[0]=='done':return {'ok':True,'path':plan['new'],'linkedRecords':plan.get('linkedRecords',len(plan.get('records',[])))}
            if existing[0]!='cancelled':raise APIError(409)
        if not self.safe_moves():raise APIError(getattr(self,'atomic_error',501))
        with self.store.lock,self.store.directory('/'.join(p[:-1])) as fd:
            st=os.stat(p[-1],dir_fd=fd,follow_symlinks=False)
            if not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)) or revision(st)!=data['revision']:raise APIError(409)
            if stat.S_ISREG(st.st_mode) and (not PHOTO.search(p[-1]) or name.rsplit('.',1)[-1].lower()!=p[-1].rsplit('.',1)[-1].lower()):raise APIError(400)
            # Destination directory must exist; no implicit parent creation.
            with self.store.directory(destination):pass
            settings,records=self.snapshot(old,new)
            plan={'kind':'move','old':old,'new':new,'sourceRevision':data['revision'],'inode':[st.st_dev,st.st_ino],'settings':settings,'records':records,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'request':data}
            return self.execute(ident,plan)
    def restore(self,ident):
        self.store.write_check()
        if not isinstance(ident,str) or not re.fullmatch(r'[a-f0-9]{32}',ident):raise APIError(400)
        opid=hashlib.sha256(('restore:'+ident).encode()).hexdigest()[:32]
        with self.db() as db:existing=db.execute('SELECT status,payload FROM operations WHERE id=?',(opid,)).fetchone()
        if existing:
            previous=json.loads(existing[1])
            if previous.get('kind')!='restore' or previous.get('trashId')!=ident:raise APIError(409)
            if existing[0]=='done':return {'ok':True,'path':previous['new']}
        if not self.safe_moves():raise APIError(getattr(self,'atomic_error',501))
        with self.store.lock,self.store.trash_root() as root:
            fd=os.open(ident,DIR_FLAGS,dir_fd=root)
            try:
                meta=self.store.read_meta(fd);st=os.stat('photo',dir_fd=fd,follow_symlinks=False)
                if not stat.S_ISREG(st.st_mode):raise APIError(400)
            finally:os.close(fd)
            settings,records=self.snapshot(meta['path'],meta['path'],meta)
            plan={'kind':'restore','trashId':ident,'old':meta['path'],'new':meta['path'],'sourceRevision':revision(st),'inode':[st.st_dev,st.st_ino],'settings':None,'records':records,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
            return self.execute(opid,plan)

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
        if self.server.auth is not None and self.server.auth.configured():
            if not value.startswith('Bearer ') or not self.server.auth.valid(value[7:]): raise APIError(401)
        elif not hmac.compare_digest(value.encode(),('Bearer '+self.server.token).encode()): raise APIError(401)
    def do_OPTIONS(self):
        if self.headers.get('Origin')!=self.server.origin: self.reply(403,{'error':'forbidden'}); return
        self.send_response(204); self.cors(); self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS'); self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type'); self.end_headers()
    def do_GET(self): self.run_request(False)
    def do_POST(self): self.run_request(True)
    def run_request(self,post):
        route=urlsplit(self.path).path
        metadata={'/api/list','/api/settings','/api/album-index','/api/journal','/api/journal-backup','/api/trash','/api/restore','/api/files'}
        if route=='/api/upload':
            # Long transfers serialize file writes without holding up record reads/writes.
            with self.server.store.lock:
                with self.server.metadata_lock:
                    try:
                        self.authorized()
                        if self.server.files is not None:self.server.files.recover()
                    except APIError as error:self.reply(error.status,{'error':'request_rejected'});return
                self.dispatch_request(post)
        elif route in metadata:
            # File operations take the photo lock first; a slow upload must not freeze records.
            context=self.server.store.lock if route in ('/api/trash','/api/restore','/api/files') else contextlib.nullcontext()
            with context,self.server.metadata_lock:
                try:
                    self.authorized()
                    if self.server.files is not None:self.server.files.recover()
                except APIError as error:self.reply(error.status,{'error':'request_rejected'});return
                self.dispatch_request(post)
        else:self.dispatch_request(post)
    def dispatch_request(self,post):
        try:
            route=urlsplit(self.path)
            if post and route.path=='/api/login' and self.server.auth is not None:
                if self.headers.get('Origin')!=self.server.origin: raise APIError(403)
                self.reply(200,self.server.auth.login(self.read_auth_body()));return
            self.authorized()
            if post and route.path=='/api/account' and self.server.auth is not None:
                self.server.auth.setup(self.read_auth_body());self.reply(201,{'username':FamilyAuth.USERNAME});return
            if post and route.path=='/api/logout' and self.server.auth is not None:
                self.server.auth.logout(self.headers.get('Authorization','')[7:]);self.reply(200,{'ok':True});return
            route=urlsplit(self.path); query=parse_qs(route.query,keep_blank_values=True,strict_parsing=True)
            if any(len(v)!=1 for v in query.values()): raise APIError(400)
            q=lambda k,default='':query.get(k,[default])[0]
            store=self.server.store
            if route.path=='/api/files':
                if not post:raise APIError(405)
                if self.server.files is None or not self.server.auth.configured():raise APIError(409)
                if self.headers.get('Transfer-Encoding'):raise APIError(400)
                length=int(self.headers.get('Content-Length','0'))
                if length<=0 or length>16384 or self.headers.get_content_type()!='application/json':raise APIError(400)
                self.reply(200,self.server.files.perform(json.loads(self.rfile.read(length))));return
            if route.path in ('/api/journal','/api/journal-backup'):
                if self.server.journal is None or not self.server.auth.configured(): raise APIError(409)
                if route.path=='/api/journal-backup':
                    if post: raise APIError(405)
                    self.send_journal_backup();return
                if post:
                    if self.headers.get('Transfer-Encoding'): raise APIError(400)
                    length=int(self.headers.get('Content-Length','0'))
                    if length<=0 or length>131072 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    self.reply(200,self.server.journal.mutate(json.loads(self.rfile.read(length))));return
                if set(query)-{'id','target','kind','year','q','trash','offset'}: raise APIError(400)
                if 'id' in query:
                    if len(query)!=1: raise APIError(400)
                    self.reply(200,self.server.journal.get(q('id')));return
                if q('trash','0') not in ('0','1'): raise APIError(400)
                self.reply(200,self.server.journal.listing(q('target'),q('kind'),q('year'),q('q'),q('trash','0')=='1',int(q('offset','0'))));return
            if not post:
                if route.path=='/api/capabilities': self.reply(200,{'version':2,'thumbnails':bool(Image),'upload':store.writable,'trash':store.writable and (self.server.files is None or self.server.files.safe_moves()),'download':True,'maxUpload':MAX_UPLOAD,'sharedSettings':self.server.settings is not None,'sharedArchive':self.server.archive is not None,'randomAlbums':self.server.archive is not None,'familyLogin':self.server.auth is not None,'accountSetup':self.server.auth is not None and not self.server.auth.configured(),'journalRecords':self.server.journal is not None and self.server.auth.configured(),'fileManagement':self.server.files is not None and store.writable and self.server.auth.configured(),'fileOperationsBlocked':self.server.files is not None and self.server.files.blocked,'safeMoves':self.server.files is not None and self.server.files.safe_moves()}); return
                if route.path=='/api/settings' and self.server.settings is not None: self.reply(200,self.server.settings.read()); return
                if route.path=='/api/list': self.reply(200,store.listing(q('path'),int(q('offset','0')))); return
                if route.path=='/api/trash': self.reply(200,store.trash_list()); return
                if route.path in ('/api/image','/api/download','/api/thumbnail'):
                    self.send_photo(q('path'),route.path,q('revision')); return
            else:
                if self.headers.get('Transfer-Encoding'): raise APIError(400)
                length=int(self.headers.get('Content-Length','0'))
                if route.path=='/api/album-index' and self.server.archive is not None:
                    if length<=0 or length>1024 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict) or set(data)-{'key','year','refresh','seed'}: raise APIError(400)
                    key=data.get('key');year=data.get('year','');refresh=data.get('refresh',False);seed=data.get('seed','')
                    if not isinstance(seed,str) or (seed and not re.fullmatch(r'[a-f0-9]{32}',seed)): raise APIError(400)
                    if not isinstance(key,str) or key not in ALBUM_KEYS or not isinstance(year,str) or (year and year!='other' and not re.fullmatch(r'(19|20)[0-9]{2}',year)) or type(refresh) is not bool: raise APIError(400)
                    settings=self.server.settings.read()
                    if key!='home' and key not in settings['albums']:
                        self.reply(200,{'items':[],'unbound':True,'shared':True});return
                    binding=album_binding(settings['albums'].get(key,''))
                    self.reply(200,self.server.archive.collection(key,binding,year,refresh,seed=seed));return
                if route.path=='/api/settings' and self.server.settings is not None:
                    if length<=0 or length>32768 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    self.reply(200,self.server.settings.patch(json.loads(self.rfile.read(length)))); return
                if route.path=='/api/upload':
                    if self.headers.get_content_type()!='application/octet-stream': raise APIError(415)
                    result=store.upload(q('path'),q('name'),self.rfile,length)
                    if self.server.files is not None:self.server.files.invalidate()
                    self.reply(201,result); return
                if route.path in ('/api/trash','/api/restore'):
                    if length<=0 or length>16384 or self.headers.get_content_type()!='application/json': raise APIError(400)
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict): raise APIError(400)
                    store.write_check()
                    if route.path=='/api/trash' and self.server.files is not None and not self.server.files.safe_moves():raise APIError(getattr(self.server.files,'atomic_error',501))
                    result=store.trash(data.get('path'),data.get('revision')) if route.path=='/api/trash' else (self.server.files.restore(data.get('id')) if self.server.files is not None else store.restore(data.get('id')))
                    if self.server.files is not None:self.server.files.invalidate()
                    self.reply(200,result); return
            raise APIError(404)
        except APIError as e: self.reply(e.status,{'error':'request_rejected'})
        except FileExistsError: self.reply(409,{'error':'name_conflict'})
        except FileNotFoundError: self.reply(404,{'error':'not_found'})
        except PermissionError: self.reply(403,{'error':'permission_denied'})
        except (ValueError,TypeError,KeyError): self.reply(400,{'error':'invalid_request'})
        except (BrokenPipeError,ConnectionResetError,TimeoutError): pass
        except OSError as error: self.reply(403 if error.errno in (errno.EROFS,errno.EACCES,errno.EPERM) else 400,{'error':'filesystem_request_rejected'})
        except Exception: self.reply(500,{'error':'internal_error'})
    def send_journal_backup(self):
        path=self.server.journal.backup()
        try:
            with open(path,'rb') as f:
                size=os.fstat(f.fileno()).st_size
                if size>64*1024*1024:raise APIError(413)
                path.unlink() # The open descriptor owns the temporary snapshot during transfer.
                self.send_response(200);self.cors();self.send_header('Content-Type','application/octet-stream')
                self.send_header('Content-Disposition','attachment; filename="family-journal-backup.sqlite3"')
                self.send_header('Content-Length',str(size));self.end_headers()
                while True:
                    chunk=f.read(65536)
                    if not chunk:break
                    self.wfile.write(chunk)
        finally:path.unlink(missing_ok=True)
    def read_auth_body(self):
        if self.headers.get('Transfer-Encoding'): raise APIError(400)
        length=int(self.headers.get('Content-Length','0'))
        if length<=0 or length>2048 or self.headers.get_content_type()!='application/json': raise APIError(400)
        return json.loads(self.rfile.read(length))
    def send_photo(self,path,route,expected=''):
        if expected and not re.fullmatch(r'[a-f0-9]{64}',expected): raise APIError(400)
        store=self.server.store
        with store.photo(path) as (fd,st):
            if expected and revision(st)!=expected: raise APIError(409)
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
                if expected and revision(os.fstat(fd))!=expected: raise APIError(409)
                self.send_response(200); self.cors(); self.send_header('Content-Type','image/jpeg'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw); return
            if st.st_size>limit: raise APIError(413)
            if expected and route=='/api/image':
                raw=bytearray()
                while len(raw)<st.st_size:
                    chunk=os.read(fd,min(65536,st.st_size-len(raw)))
                    if not chunk:break
                    raw.extend(chunk)
                if revision(os.fstat(fd))!=expected or len(raw)!=st.st_size: raise APIError(409)
                self.send_response(200);self.cors();self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
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
        self.auth=FamilyAuth(settings.root) if settings is not None else None
        self.journal=JournalStore(settings.root,store) if settings is not None else None
        self.metadata_lock=threading.RLock()
        self.files=FileManager(store,settings,self.journal,self.archive) if settings is not None else None
        if self.files is not None:
            try:self.files.recover()
            except APIError:pass
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
