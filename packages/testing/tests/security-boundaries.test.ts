import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|js)$/.test(entry.name) ? [full] : [];
  });
}

describe('security architecture', () => {
  it('does not use Telegram forward for anonymous relay', () => {
    const files = sourceFiles(path.join(root, 'apps/bot-api/src'));
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/forwardMessage|forward_message|forwardMessages/);
  });

  it('does not expose arbitrary SQL in the Worker envelope', () => {
    const contracts = readFileSync(
      path.join(root, 'packages/database-contracts/src/index.ts'),
      'utf8',
    );
    expect(contracts).toContain('workerOperations');
    expect(contracts).toContain('operation: z.string()');
    expect(contracts).toContain('input: z.unknown()');
    expect(contracts).not.toMatch(/workerEnvelopeSchema\s*=\s*z\.object\(\{[^}]*\bsql\s*:/s);
  });

  it('keeps production digital YooKassa disabled', () => {
    const env = readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(env).toContain('YOOKASSA_DIGITAL_PREMIUM_ENABLED=false');
    const adapter = readFileSync(path.join(root, 'apps/bot-api/src/payments/yookassa.ts'), 'utf8');
    expect(adapter).toContain('Telegram digital Premium cannot be sold through YooKassa');
  });

  it('keeps Russian user-facing copy centralized', () => {
    const directories = [path.join(root, 'apps/bot-api/src'), path.join(root, 'apps/miniapp/src')];
    const violations = directories.flatMap((directory) =>
      sourceFiles(directory)
        .filter((file) => /[А-Яа-яЁё]/.test(readFileSync(file, 'utf8')))
        .map((file) => path.relative(root, file)),
    );
    expect(violations).toEqual([]);
    const locale = readFileSync(path.join(root, 'packages/shared/src/locales/ru.ts'), 'utf8');
    expect(locale).toContain('export const ru');
  });
});
