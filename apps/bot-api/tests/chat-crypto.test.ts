import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptChatContent, encryptChatContent } from '../src/chat-crypto.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('anonymous chat content encryption', () => {
  const secret = 'chat-test-session-secret-with-at-least-32-characters';

  it('round-trips content without exposing plaintext', async () => {
    const plaintext = '*подходит ближе* Привет';
    const encrypted = await encryptChatContent(plaintext, secret);

    expect(encrypted).not.toContain(plaintext);
    await expect(decryptChatContent(encrypted, secret)).resolves.toBe(plaintext);
  });

  it('rejects a tampered payload', async () => {
    const encrypted = await encryptChatContent('Защищённое сообщение', secret);
    const tampered = `${encrypted.slice(0, -2)}aa`;

    await expect(decryptChatContent(tampered, secret)).rejects.toThrow();
  });
});
