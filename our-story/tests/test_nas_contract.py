"""Exercise the existing NAS API in an isolated process with temporary fixtures.
No remote NAS requests, credentials, deployment changes or source writes.
Run from the repo root: python -B -m unittest discover -s our-story/tests -v
"""
import http.client
import importlib.util
import json
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

SOURCE = Path(__file__).resolve().parents[2] / 'nas-photo-test' / 'server.py'
spec = importlib.util.spec_from_file_location('nas_contract_fixture', SOURCE)
api = importlib.util.module_from_spec(spec)
# Reading and compiling avoids writing a pycache next to the existing server.
exec(compile(SOURCE.read_text(), str(SOURCE), 'exec'), api.__dict__)


class NasContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        api.ROOT = cls.root / 'photos'
        api.ROOT.mkdir()
        api.AUTH_FILE = cls.root / 'login.json'
        api.SESSIONS.clear()
        cls.password = secrets.token_urlsafe(24)
        salt = secrets.token_hex(16)
        api.AUTH_FILE.write_text(json.dumps({
            'user': 'maru', 'salt': salt,
            'hash': api.password_hash(cls.password, salt),
        }))
        (api.ROOT / 'sample.jpg').write_bytes(b'fixture-image-bytes')
        (api.ROOT / 'private-folder').mkdir()
        (cls.root / 'outside.jpg').write_bytes(b'outside-fixture')
        (api.ROOT / 'outside-link.jpg').symlink_to(cls.root / 'outside.jpg')
        (api.ROOT / 'movie.mp4').write_bytes(b'fixture-video')
        with (api.ROOT / 'large.jpg').open('wb') as f:
            f.truncate(15 * 1024 * 1024 + 1)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), api.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        status, payload = cls.request('/api/login', method='POST', body={
            'username': 'maru', 'password': cls.password,
        })
        if status != 200:
            raise AssertionError('Fixture login failed')
        cls.session = json.loads(payload)['session']

    @classmethod
    def request(cls, path, method='GET', body=None, token=None, origin=api.ORIGIN):
        headers = {'Origin': origin}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        raw = None
        if body is not None:
            raw = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        conn = http.client.HTTPConnection('127.0.0.1', cls.server.server_port, timeout=5)
        try:
            conn.request(method, path, body=raw, headers=headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.tmp.cleanup()

    def test_no_session_is_denied(self):
        self.assertEqual(self.request('/api/list')[0], 401)

    def test_fixed_token_is_not_a_session(self):
        self.assertEqual(self.request('/api/list', token='fixture-old-fixed-token')[0], 401)

    def test_current_pages_origin_and_login_session_work(self):
        status, body = self.request('/api/list', token=self.session)
        self.assertEqual(status, 200)
        names = [x['name'] for x in json.loads(body)['items']]
        self.assertIn('sample.jpg', names)
        self.assertNotIn('outside-link.jpg', names)
        self.assertNotIn('movie.mp4', names)

    def test_unconfigured_new_host_is_denied(self):
        self.assertEqual(self.request('/api/list', token=self.session,
                                     origin='https://example.pages.dev')[0], 403)

    def test_image_bytes_are_readable_with_session(self):
        status, body = self.request('/api/image?path=sample.jpg', token=self.session)
        self.assertEqual(status, 200)
        self.assertEqual(body, b'fixture-image-bytes')

    def test_oversized_image_is_denied(self):
        self.assertEqual(self.request('/api/image?path=large.jpg', token=self.session)[0], 413)

    def test_path_traversal_is_denied(self):
        self.assertEqual(self.request('/api/image?path=../outside.jpg', token=self.session)[0], 400)

    def test_escaping_symlink_is_denied(self):
        self.assertEqual(self.request('/api/image?path=outside-link.jpg', token=self.session)[0], 400)

    def test_video_is_not_implemented(self):
        self.assertEqual(self.request('/api/image?path=movie.mp4', token=self.session)[0], 404)

    def test_record_write_endpoint_is_not_implemented(self):
        self.assertEqual(self.request('/api/trips', method='POST', body={'title':'fixture'},
                                     token=self.session)[0], 404)

    def test_cors_preflight_for_current_pages_origin(self):
        self.assertEqual(self.request('/api/list', method='OPTIONS')[0], 204)

    def test_logout_revokes_a_session(self):
        token = secrets.token_urlsafe(24)
        api.SESSIONS[token] = api.time.time() + 60
        self.assertEqual(self.request('/api/status', token=token)[0], 200)
        self.assertEqual(self.request('/api/logout', method='POST', body={}, token=token)[0], 200)
        self.assertEqual(self.request('/api/status', token=token)[0], 401)


if __name__ == '__main__':
    unittest.main()
