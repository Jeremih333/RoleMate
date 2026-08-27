import { describe, expect, it } from 'vitest';
import { telegramAudioMetadata } from '../src/telegram-audio-metadata.js';

describe('Telegram audio metadata', () => {
  it('prefers Telegram title, performer and cover metadata', () => {
    expect(
      telegramAudioMetadata({
        title: '  Midnight Story ',
        performer: ' RoleMate Artist ',
        file_name: 'wrong - fallback.mp3',
        thumbnail: { file_id: 'cover-file-id' },
      }),
    ).toEqual({
      trackTitle: 'Midnight Story',
      trackPerformer: 'RoleMate Artist',
      thumbnailTelegramFileId: 'cover-file-id',
    });
  });

  it('uses a Telegram filename as a safe fallback when audio tags are absent', () => {
    expect(telegramAudioMetadata({ file_name: 'Artist - Track title.flac' })).toEqual({
      trackTitle: 'Track title',
      trackPerformer: 'Artist',
    });
    expect(telegramAudioMetadata({ file_name: 'Untitled recording.ogg' })).toEqual({
      trackTitle: 'Untitled recording',
    });
    expect(telegramAudioMetadata({ file_name: 'Bladee — Dg Jeans.mp3' })).toEqual({
      trackTitle: 'Dg Jeans',
      trackPerformer: 'Bladee',
    });
  });

  it('bounds untrusted embedded metadata before it reaches the Worker contract', () => {
    const metadata = telegramAudioMetadata({
      title: ` Track ${'x'.repeat(300)} `,
      performer: ` Artist ${'y'.repeat(300)} `,
    });

    expect(metadata.trackTitle).toHaveLength(160);
    expect(metadata.trackPerformer).toHaveLength(160);
  });

  it('keeps only a bounded Telegram image identifier as the audio cover', () => {
    expect(
      telegramAudioMetadata({
        title: 'Dg Jeans',
        performer: 'Bladee',
        thumbnail: { file_id: 'valid_cover-id', width: 320, height: 320, file_size: 48_000 },
      }),
    ).toMatchObject({ thumbnailTelegramFileId: 'valid_cover-id' });
    expect(
      telegramAudioMetadata({
        title: 'Dg Jeans',
        thumbnail: { file_id: 'broken cover id', width: 320, height: 320 },
      }),
    ).not.toHaveProperty('thumbnailTelegramFileId');
    expect(
      telegramAudioMetadata({
        title: 'Dg Jeans',
        thumbnail: { file_id: 'cover-id', width: 0, height: 320 },
      }),
    ).not.toHaveProperty('thumbnailTelegramFileId');
  });
});
