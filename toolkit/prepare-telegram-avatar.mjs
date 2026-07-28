import { stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const workspace = process.cwd();
const source = path.join(workspace, 'assets/generated/telegram-bot-avatar.png');
const target = path.join(workspace, 'assets/generated/telegram-bot-avatar.jpg');

await sharp(source)
  .resize(1024, 1024, { fit: 'cover' })
  .flatten({ background: '#111827' })
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(target);

const metadata = await sharp(target).metadata();
const file = await stat(target);
if (metadata.format !== 'jpeg' || metadata.width !== 1024 || metadata.height !== 1024) {
  throw new Error('Telegram avatar conversion did not produce a 1024x1024 JPEG');
}
if (file.size > 10 * 1024 * 1024) {
  throw new Error('Telegram avatar exceeds 10 MB');
}

console.log(
  JSON.stringify({
    path: target,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    bytes: file.size,
  }),
);
