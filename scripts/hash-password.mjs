import { randomBytes, scryptSync } from 'node:crypto';
if (!process.stdin.isTTY) {
  console.error('Run this command in an interactive terminal.');
  process.exit(1);
}
process.stderr.write('Password (hidden): ');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
let password = '';
const finish = () => {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stderr.write('\n');
};
process.stdin.on('data', (chunk) => {
  for (const char of chunk) {
    if (char === '\u0003') {
      finish();
      process.exit(130);
    }
    if (char === '\r' || char === '\n') {
      finish();
      if (password.length < 12) {
        console.error('Use a password of at least 12 characters.');
        process.exit(1);
      }
      const salt = randomBytes(24).toString('hex');
      console.log('scrypt:' + salt + ':' + scryptSync(password, salt, 64).toString('hex'));
      password = '';
      process.exit(0);
    }
    if (char === '\u007f') {
      password = password.slice(0, -1);
    } else if (char >= ' ') {
      password += char;
    }
  }
});
