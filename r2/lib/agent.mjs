// The agent of one R2 run (plan 0027): `claude -p` with stream-json input and output, so it stays alive between the human's turns (a
// follow-up is a second user message, not a resumed session), and in W2 its session exists, through the hooks, before the human sends the
// message from the window. Every stdout line is kept with the host's time, as in R1 ({"t", "line"}). The process is the harness's own
// child with its own pipes; nothing is ever typed into a terminal.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

export const userMessage = text => `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;

// `bin`: the round's pinned Claude Code (round 2); round 1 ran the `claude` on PATH.
export function startAgent({ bin = 'claude', args, cwd, env, outDir, minutes }) {
  const child = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = createWriteStream(join(outDir, 'transcript.jsonl'));
  child.stderr.pipe(createWriteStream(join(outDir, 'agent-stderr.log')));
  let buf = '';
  let waiting = null;
  let timedOut = false;
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      out.write(`${JSON.stringify({ t: Date.now(), line })}\n`);
      let e = null;
      try {
        e = JSON.parse(line);
      } catch {}
      if (e?.type === 'result' && waiting) waiting(e), (waiting = null);
    }
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10000).unref();
  }, minutes * 60000);
  return {
    pid: child.pid,
    /** Sends one user message and waits for that turn's `result` event (null: the agent exited or ran out of time first). */
    turn(text) {
      const done = new Promise(resolve => (waiting = resolve));
      child.stdin.write(userMessage(text));
      return Promise.race([done, exited.then(() => null)]);
    },
    async end() {
      child.stdin.end();
      const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('kill'), 15000))]);
      if (code === 'kill') child.kill('SIGTERM');
      clearTimeout(timer);
      await new Promise(r => out.end(r));
      return { code: code === 'kill' ? null : code, timedOut };
    },
  };
}
