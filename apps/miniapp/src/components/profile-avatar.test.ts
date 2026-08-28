import { describe, expect, it } from 'vitest';
import { avatarInitial } from './profile-avatar.js';

// Names are written as escapes: user-facing Cyrillic belongs in the locale
// package, and the architecture test keeps it out of application sources.
const RAFUSHA = '\u0440\u0430\u0444\u0443\u0448\u0430';
const VLAD = '  \u0432\u043b\u0430\u0434';

describe('avatar initials', () => {
  it('uses the first letter of the name in upper case', () => {
    expect(avatarInitial(RAFUSHA)).toBe('\u0420');
    expect(avatarInitial('Tester')).toBe('T');
    expect(avatarInitial(VLAD)).toBe('\u0412');
  });

  it('keeps a leading emoji whole instead of splitting the surrogate pair', () => {
    expect(avatarInitial('🐱 cat')).toBe('🐱');
  });

  it('falls back when there is no name to take a letter from', () => {
    expect(avatarInitial('')).toBe('R');
    expect(avatarInitial('   ')).toBe('R');
  });
});
