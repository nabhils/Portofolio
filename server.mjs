import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const scrypt = promisify(scryptCallback);
const here = fileURLToPath(new URL('.', import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const host = isProduction ? '0.0.0.0' : '127.0.0.1';
const dataDir = resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(here, 'data'));
const contentPath = join(dataDir, 'content.json');
const seedPath = join(here, 'src', 'content.json');
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 6;

const securityHeaders = (res, html = false) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (html) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' mailto:");
};

function sendJson(res, status, payload) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolveBody, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) { reject(Object.assign(new Error('Ukuran permintaan terlalu besar.'), { status: 413 })); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(raw || '{}')); }
      catch { reject(Object.assign(new Error('Format data tidak valid.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function safeText(value, field, max = 1200, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Data ${field} tidak valid.`);
  return value.trim();
}

function safeUrl(value, field, required = false) {
  const raw = safeText(value ?? '', field, 2048, required);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.href;
  } catch { throw new Error(`Tautan ${field} harus menggunakan HTTPS.`); }
}

function safeList(value, field, mapper, max = 40) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Daftar ${field} tidak valid.`);
  return value.map((item, index) => mapper(item, `${field} ${index + 1}`));
}

function validateContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Format konten tidak valid.');
  const stats = safeList(input.stats, 'statistik', (item, label) => ({ value: safeText(item?.value, `${label} angka`, 40, true), label: safeText(item?.label, `${label} label`, 100, true) }));
  const skills = safeList(input.skills, 'keahlian', (item, label) => safeText(item, label, 100, true));
  const projects = safeList(input.projects, 'proyek', (item, label) => ({
    tag: safeText(item?.tag, `${label} kategori`, 80, true), sport: safeText(item?.sport, `${label} olahraga`, 80), year: safeText(item?.year, `${label} tahun`, 30),
    title: safeText(item?.title, `${label} judul`, 180, true), desc: safeText(item?.desc, `${label} ringkasan`, 1200),
    color: ['lime', 'blue', 'orange'].includes(item?.color) ? item.color : 'lime', number: safeText(item?.number, `${label} nomor`, 20),
    image: safeUrl(item?.image, `${label} gambar`), url: safeUrl(item?.url, `${label} tautan`), published: item?.published !== false,
  }));
  const achievements = safeList(input.achievements, 'prestasi', (item, label) => ({ year: safeText(item?.year, `${label} tahun`, 30), title: safeText(item?.title, `${label} judul`, 180, true), detail: safeText(item?.detail, `${label} detail`, 300), url: safeUrl(item?.url, `${label} tautan`) }));
  const journey = safeList(input.journey, 'perjalanan', (item, label) => ({ year: safeText(item?.year, `${label} periode`, 60), title: safeText(item?.title, `${label} peran`, 180, true), detail: safeText(item?.detail, `${label} organisasi`, 300), url: safeUrl(item?.url, `${label} tautan`) }));
  const email = safeText(input.email, 'email', 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Alamat email tidak valid.');
  return {
    name: safeText(input.name, 'nama', 100, true), sport: safeText(input.sport, 'profesi', 120), location: safeText(input.location, 'lokasi', 100),
    profilePhoto: safeUrl(input.profilePhoto, 'foto profil'), headline: safeText(input.headline, 'headline', 300, true),
    intro: safeText(input.intro, 'perkenalan', 1500), bio: safeText(input.bio, 'biografi', 3000), email,
    instagram: safeUrl(input.instagram, 'Instagram'), linkedin: safeUrl(input.linkedin, 'LinkedIn'), stats, skills, projects, achievements, journey,
  };
}

async function getContent() { return JSON.parse(await readFile(contentPath, 'utf8')); }
async function saveContent(content) {
  await mkdir(dataDir, { recursive: true });
  const tempPath = `${contentPath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, contentPath);
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const id = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('portfolio_session='))?.slice('portfolio_session='.length);
  const session = id && sessions.get(id);
  if (!session || session.expiresAt < Date.now()) { if (id) sessions.delete(id); return null; }
  session.expiresAt = Date.now() + SESSION_TTL;
  return { id, ...session };
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (isProduction) return parsed.host === req.headers.host;
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) && ['5173', String(port)].includes(parsed.port);
  } catch { return false; }
}

function sessionCookie(id, maxAge = 28800) {
  return `portfolio_session=${id}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`;
}

function verifyCsrf(req, session) {
  const token = req.headers['x-csrf-token'];
  return typeof token === 'string' && token.length === session.csrfToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken));
}

function checkLoginLimit(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(timestamp => now - timestamp < LOGIN_WINDOW);
  loginAttempts.set(key, attempts);
  return attempts.length < MAX_LOGIN_ATTEMPTS;
}

async function verifyAdminPassword(password) {
  const encoded = process.env.ADMIN_PASSWORD_HASH || '';
  const [, salt, expectedHex] = encoded.split('$');
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}

async function api(req, res, url) {
  if (url.pathname === '/api/content' && req.method === 'GET') {
    try { const content = await getContent(); return sendJson(res, 200, { ...content, projects: content.projects.filter(project => project.published) }); }
    catch { return sendJson(res, 500, { error: 'Konten situs gagal dimuat.' }); }
  }
  if (!url.pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    if (!originAllowed(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  }
  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    const key = req.socket.remoteAddress || 'unknown';
    if (!checkLoginLimit(key)) return sendJson(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
    let body;
    try { body = await readBody(req, 4096); } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!process.env.ADMIN_PASSWORD_HASH) return sendJson(res, 503, { error: 'Akses admin belum dikonfigurasi. Lihat panduan setup di README.' });
    if (password.length < 14 || password.length > 256 || !(await verifyAdminPassword(password))) {
      loginAttempts.set(key, [...(loginAttempts.get(key) || []), Date.now()]);
      return sendJson(res, 401, { error: 'Kredensial tidak valid.' });
    }
    loginAttempts.delete(key);
    const id = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    sessions.set(id, { csrfToken, expiresAt: Date.now() + SESSION_TTL });
    securityHeaders(res);
    res.setHeader('Set-Cookie', sessionCookie(id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ csrfToken }));
  }
  if (url.pathname === '/api/admin/session' && req.method === 'GET') {
    const session = getSession(req);
    return session ? sendJson(res, 200, { csrfToken: session.csrfToken }) : sendJson(res, 401, { error: 'Sesi tidak aktif.' });
  }
  const session = getSession(req);
  if (!session) return sendJson(res, 401, { error: 'Sesi berakhir. Silakan masuk kembali.' });
  if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
    if (!verifyCsrf(req, session)) return sendJson(res, 403, { error: 'Token keamanan tidak valid.' });
    sessions.delete(session.id);
    securityHeaders(res);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/api/admin/content' && req.method === 'GET') {
    try { return sendJson(res, 200, await getContent()); }
    catch { return sendJson(res, 500, { error: 'Konten admin gagal dimuat.' }); }
  }
  if (url.pathname === '/api/admin/content' && req.method === 'PUT') {
    if (!verifyCsrf(req, session)) return sendJson(res, 403, { error: 'Token keamanan tidak valid. Muat ulang halaman admin.' });
    try {
      const body = await readBody(req);
      const content = validateContent(body);
      await saveContent(content);
      return sendJson(res, 200, content);
    } catch (error) { return sendJson(res, error.status || 400, { error: error.message || 'Konten tidak dapat disimpan.' }); }
  }
  return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function staticFile(req, res, url) {
  const dist = resolve(here, 'dist');
  const decodedPath = decodeURIComponent(url.pathname);
  const requested = decodedPath === '/' || decodedPath === '/admin' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
  const file = resolve(dist, normalize(requested));
  if (file !== dist && !file.startsWith(dist + sep)) return sendJson(res, 403, { error: 'Akses ditolak.' });
  let target = file;
  try { if (!(await stat(target)).isFile()) throw new Error('Not a file'); }
  catch {
    if (extname(requested)) return sendJson(res, 404, { error: 'File tidak ditemukan.' });
    target = join(dist, 'index.html');
  }
  try {
    const html = extname(target) === '.html';
    securityHeaders(res, html);
    res.setHeader('Content-Type', mimeTypes[extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', html ? 'no-cache' : 'public, max-age=31536000, immutable');
    res.writeHead(200);
    createReadStream(target).pipe(res);
  } catch { sendJson(res, 503, { error: 'Build situs belum tersedia. Jalankan npm run build.' }); }
}

await mkdir(dataDir, { recursive: true });
try { await readFile(contentPath); } catch { await writeFile(contentPath, await readFile(seedPath), { mode: 0o600 }); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Metode tidak diizinkan.' });
    if (isProduction) return await staticFile(req, res, url);
    sendJson(res, 404, { error: 'Jalankan aplikasi melalui Vite pada port 5173.' });
  } catch (error) { console.error('Request error:', error); if (!res.headersSent) sendJson(res, 500, { error: 'Terjadi kesalahan server.' }); else res.destroy(); }
});

server.listen(port, host, () => console.log(`Portfolio server listening on ${host}:${port}`));
