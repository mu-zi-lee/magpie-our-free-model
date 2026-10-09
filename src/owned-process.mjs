// Pipe ownership survives a SIGKILL of the runner: EOF still closes the tunnel.
import { spawn } from 'node:child_process';
const [parent, binary, ...args] = process.argv.slice(2);
let stopping = false;
const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1000).unref();
};
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
process.stdout.on('error', stop); process.stderr.on('error', stop);
child.once('error', () => process.exit(1));
child.once('close', code => process.exit(code ?? 1));
process.stdin.resume(); process.stdin.once('end', stop);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
setInterval(() => {
  try { process.kill(Number(parent), 0); } catch { stop(); }
}, 1000).unref();
