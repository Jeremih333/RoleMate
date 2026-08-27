export interface TelegramAudioMetadataInput {
  title?: string;
  performer?: string;
  file_name?: string;
  thumbnail?: {
    file_id: string;
    width?: number;
    height?: number;
    file_size?: number;
  };
}

export interface TelegramAudioMetadata {
  trackTitle?: string;
  trackPerformer?: string;
  thumbnailTelegramFileId?: string;
}

function cleaned(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim().slice(0, 160).trim();
  return normalized ? normalized : undefined;
}

function usableThumbnailFileId(
  thumbnail: TelegramAudioMetadataInput['thumbnail'],
): string | undefined {
  if (!thumbnail) return undefined;
  const fileId = thumbnail.file_id.trim();
  if (!fileId || fileId.length > 512 || !/^[A-Za-z0-9_-]+$/.test(fileId)) return undefined;
  if (
    (thumbnail.width !== undefined && (thumbnail.width < 1 || thumbnail.width > 8_192)) ||
    (thumbnail.height !== undefined && (thumbnail.height < 1 || thumbnail.height > 8_192)) ||
    (thumbnail.file_size !== undefined &&
      (thumbnail.file_size < 1 || thumbnail.file_size > 10 * 1024 * 1024))
  ) {
    return undefined;
  }
  return fileId;
}

export function telegramAudioMetadata(input: TelegramAudioMetadataInput): TelegramAudioMetadata {
  const telegramTitle = cleaned(input.title);
  const telegramPerformer = cleaned(input.performer);
  const fileStem = cleaned(input.file_name?.replace(/\.[^.]+$/, ''));
  const filenameParts = fileStem?.split(/\s+[-–—]\s+/, 2).map((part) => part.trim());
  const filenamePerformer =
    filenameParts?.length === 2 && filenameParts[0] ? filenameParts[0] : undefined;
  const filenameTitle =
    filenameParts?.length === 2 && filenameParts[1] ? filenameParts[1] : fileStem;
  const trackTitle = telegramTitle ?? filenameTitle;
  const trackPerformer = telegramPerformer ?? filenamePerformer;
  const thumbnailTelegramFileId = usableThumbnailFileId(input.thumbnail);

  return {
    ...(trackTitle ? { trackTitle } : {}),
    ...(trackPerformer ? { trackPerformer } : {}),
    ...(thumbnailTelegramFileId ? { thumbnailTelegramFileId } : {}),
  };
}
