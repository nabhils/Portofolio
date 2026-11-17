import { scryptSync, randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';

if (!stdin.isTTY || !stdin.setRawMode) {
  console.error('Jalankan perintah ini langsung di terminal interaktif agar kata sandi tidak terlihat.');
  process.exit(1);
}

stdout.write('Kata sandi admin baru (minimal 14 karakter): ');
stdin.setEncoding('utf8');
stdin.setRawMode(true);
stdin.resume();
let password = '';
stdin.on('data', key => {
  if (key === '\u0003') { stdout.write('\nDibatalkan.\n'); process.exit(1); }
  if (key === '\r' || key === '\n') {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
    if (password.length < 14 || password.length > 256) {
      console.error('Kata sandi harus berisi 14–256 karakter.');
      process.exit(1);
    }
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    password = '';
    console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt}$${hash}`);
    process.exit(0);
  }
  if (key === '\u007f' || key === '\b') password = password.slice(0, -1);
  else if (key >= ' ' && key <= '~') password += key;
});
