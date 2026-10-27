/**
 * SmtpMailAdapter over a real (if minimal) SMTP server — the same philosophy
 * apps/sugrpay/src/adapters/accounting/zoho-books.adapter.http.test.ts uses
 * for Zoho Books: a fake standing in for the real protocol over a real
 * socket, so nodemailer's own request/response handling is exercised rather
 * than a mock of nodemailer standing in for it. In particular, this is the
 * only way to genuinely produce the split "the transaction succeeded but one
 * recipient was rejected" outcome `send()` now has to detect — a mocked
 * nodemailer would just assert my own guess at its return shape.
 *
 * No real network, no real provider: this server only ever listens on
 * 127.0.0.1 on an OS-assigned port for the duration of each test.
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationError } from '@platform/kernel';
import { getEnv, type Env } from '../../config/env.js';
import { loadEnv } from '../../config/load-env.js';
import { SmtpMailAdapter } from './smtp-mail.adapter.js';

loadEnv();

/**
 * Just enough SMTP to drive nodemailer's accepted/rejected reporting:
 * greets, accepts MAIL FROM, accepts or 550s each RCPT TO depending on
 * `rejectedRecipients`, then accepts DATA and the message body.
 */
class FakeSmtpServer {
  readonly rejectedRecipients = new Set<string>();
  private server: Server | undefined;

  async start(): Promise<number> {
    this.server = createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return (this.server!.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server ? this.server.close((err) => (err ? reject(err) : resolve())) : resolve(),
    );
  }

  private handleConnection(socket: Socket): void {
    socket.write('220 fake-smtp ready\r\n');
    let buffer = '';
    let inData = false;

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      // eslint-disable-next-line no-cond-assign
      while ((newlineIndex = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 OK: message accepted\r\n');
          }
          continue;
        }

        const [verb, ...rest] = line.split(' ');
        switch ((verb ?? '').toUpperCase()) {
          case 'EHLO':
          case 'HELO':
            socket.write('250-fake-smtp\r\n250 8BITMIME\r\n');
            break;
          case 'MAIL':
            socket.write('250 2.1.0 OK\r\n');
            break;
          case 'RCPT': {
            const address = (rest.join(' ').match(/<([^>]*)>/)?.[1] ?? '').toLowerCase();
            if (this.rejectedRecipients.has(address)) {
              socket.write('550 5.1.1 no such mailbox\r\n');
            } else {
              socket.write('250 2.1.5 OK\r\n');
            }
            break;
          }
          case 'DATA':
            inData = true;
            socket.write('354 go ahead\r\n');
            break;
          case 'QUIT':
            socket.write('221 2.0.0 bye\r\n');
            socket.end();
            break;
          default:
            socket.write('500 unrecognized command\r\n');
        }
      }
    });
  }
}

describe('SmtpMailAdapter', () => {
  let server: FakeSmtpServer;
  let port: number;
  let env: Env;

  beforeEach(async () => {
    server = new FakeSmtpServer();
    port = await server.start();
    env = { ...getEnv(), SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_SECURE: false };
  });

  afterEach(async () => {
    await server.stop();
  });

  function input() {
    return {
      to: ['ok@example.test'],
      from: { name: 'Sugrpay', address: 'billing@example.test' },
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      messageTag: { templateKey: 'test' },
      idempotencyKey: `test-${Math.random()}`,
    };
  }

  it('reports success when the relay accepts every recipient', async () => {
    const adapter = new SmtpMailAdapter(env);
    const result = await adapter.send(input());
    expect(result.recipients).toEqual(['ok@example.test']);
    expect(result.providerMessageId).toBeTruthy();
  });

  it('throws instead of reporting success when the relay rejects the recipient', async () => {
    server.rejectedRecipients.add('bad@example.test');
    const adapter = new SmtpMailAdapter(env);

    await expect(
      adapter.send({ ...input(), to: ['bad@example.test'] }),
    ).rejects.toThrow(IntegrationError);
  });

  it('throws on a partial rejection even though the transaction itself succeeded', async () => {
    server.rejectedRecipients.add('bad@example.test');
    const adapter = new SmtpMailAdapter(env);

    await expect(
      adapter.send({ ...input(), to: ['ok@example.test'], cc: ['bad@example.test'] }),
    ).rejects.toThrow(/rejected 1 recipient/);
  });
});
