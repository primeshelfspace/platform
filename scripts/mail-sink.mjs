#!/usr/bin/env node
/**
 * Dependency-free SMTP sink — the Mailcatcher stand-in for workstations where
 * Docker is unavailable. Accepts mail on :1025, stores each message as .eml
 * under .local/mail, and serves a browsable list on :1080.
 *
 * It is deliberately permissive: no auth, no TLS, localhost only. It exists so
 * that no local development path reaches a real email provider (TER-001 §3.2).
 */
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIL_DIR = path.join(ROOT, '.local', 'mail');
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);
const UI_PORT = Number(process.env.MAIL_UI_PORT ?? 1080);

fs.mkdirSync(MAIL_DIR, { recursive: true });

let seq = 0;

const smtp = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let message = { from: '', to: [], data: '' };

  const send = (line) => socket.write(`${line}\r\n`);
  send('220 fenwick-mail-sink ESMTP ready');

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');

    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      if (inData) {
        if (line === '.') {
          inData = false;
          persist(message);
          message = { from: '', to: [], data: '' };
          send('250 2.0.0 Ok: queued');
        } else {
          // Undo dot-stuffing per RFC 5321 §4.5.2.
          message.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
        }
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        send('250-fenwick-mail-sink');
        send('250-8BITMIME');
        send('250 SIZE 26214400');
      } else if (upper.startsWith('MAIL FROM')) {
        message.from = extractAddress(line);
        send('250 2.1.0 Ok');
      } else if (upper.startsWith('RCPT TO')) {
        message.to.push(extractAddress(line));
        send('250 2.1.5 Ok');
      } else if (upper === 'DATA') {
        inData = true;
        send('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'RSET') {
        message = { from: '', to: [], data: '' };
        send('250 2.0.0 Ok');
      } else if (upper === 'QUIT') {
        send('221 2.0.0 Bye');
        socket.end();
      } else if (upper === 'NOOP') {
        send('250 2.0.0 Ok');
      } else {
        send('250 2.0.0 Ok');
      }
    }
  });

  socket.on('error', () => socket.destroy());
});

function extractAddress(line) {
  const m = /<([^>]*)>/.exec(line);
  return m?.[1] ?? line.split(':').slice(1).join(':').trim();
}

function persist(message) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${String(++seq).padStart(4, '0')}.eml`;
  const header = [
    `X-Sink-From: ${message.from}`,
    `X-Sink-To: ${message.to.join(', ')}`,
    `X-Sink-Received: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(MAIL_DIR, name), header + message.data, 'utf8');
  process.stdout.write(`[mail-sink] captured ${name} → ${message.to.join(', ')}\n`);
}

const ui = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${UI_PORT}`);

  if (url.pathname === '/messages') {
    const files = listMessages();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(files, null, 2));
    return;
  }

  if (url.pathname.startsWith('/message/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/message/'.length)));
    const file = path.join(MAIL_DIR, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(fs.readFileSync(file, 'utf8'));
    return;
  }

  if (url.pathname === '/clear') {
    for (const f of fs.readdirSync(MAIL_DIR)) fs.unlinkSync(path.join(MAIL_DIR, f));
    res.writeHead(302, { location: '/' }).end();
    return;
  }

  const rows = listMessages()
    .map(
      (m) =>
        `<tr><td><a href="/message/${encodeURIComponent(m.file)}">${escapeHtml(m.subject)}</a></td>` +
        `<td>${escapeHtml(m.to)}</td><td>${escapeHtml(m.received)}</td></tr>`,
    )
    .join('');

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Fenwick mail sink</title>
<style>
  body{font:14px/1.5 ui-sans-serif,system-ui;margin:2rem;background:#EDF1EE;color:#16261F}
  h1{font-size:1.1rem;letter-spacing:.02em}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden}
  td,th{padding:.6rem .8rem;text-align:left;border-bottom:1px solid #D9E2DA}
  a{color:#2D6A6A}
  .empty{padding:2rem;background:#fff;border-radius:8px;color:#5B6B63}
</style>
<h1>Fenwick mail sink <small style="font-weight:400;color:#5B6B63">— captured outbound mail</small></h1>
${rows ? `<table><tr><th>Subject</th><th>To</th><th>Received</th></tr>${rows}</table>` : '<div class="empty">No messages captured yet.</div>'}
<p><a href="/clear">Clear all</a></p>`);
});

function listMessages() {
  return fs
    .readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .reverse()
    .map((file) => {
      const raw = fs.readFileSync(path.join(MAIL_DIR, file), 'utf8');
      return {
        file,
        subject: header(raw, 'Subject') || '(no subject)',
        to: header(raw, 'X-Sink-To'),
        received: header(raw, 'X-Sink-Received'),
      };
    });
}

function header(raw, name) {
  const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(raw);
  return m?.[1]?.trim() ?? '';
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch],
  );
}

// Bound to ::1 AND 127.0.0.1 rather than IPv4 alone. `localhost` resolves to
// ::1 first on macOS and modern Linux, so an IPv4-only bind means anything
// configured with SMTP_HOST=localhost — which .env.example is — fails to
// connect with ECONNREFUSED while the sink sits there looking healthy.
// Listening on the loopback interface generally keeps it local-only.
smtp.listen(SMTP_PORT, '::', () =>
  process.stdout.write(`[mail-sink] SMTP on localhost:${SMTP_PORT} (IPv4 + IPv6)\n`),
);
ui.listen(UI_PORT, '::', () =>
  process.stdout.write(`[mail-sink] UI on http://localhost:${UI_PORT}\n`),
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    smtp.close();
    ui.close();
    process.exit(0);
  });
}
