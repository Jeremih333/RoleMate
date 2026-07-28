import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets/source/rolemate-hero.png');
const generated = path.join(root, 'assets/generated');
const publicAssets = path.join(root, 'apps/miniapp/public/assets');

await Promise.all([
  mkdir(generated, { recursive: true }),
  mkdir(publicAssets, { recursive: true }),
]);

await sharp(source)
  .resize(1600, 1067, { fit: 'cover', position: 'centre' })
  .webp({ quality: 84, effort: 5 })
  .toFile(path.join(generated, 'rolemate-hero.webp'));

await sharp(path.join(generated, 'rolemate-hero.webp')).toFile(
  path.join(publicAssets, 'rolemate-hero.webp'),
);

const overlay = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" x2="1">
        <stop offset="0" stop-color="#0d0b12" stop-opacity=".96"/>
        <stop offset=".7" stop-color="#0d0b12" stop-opacity=".35"/>
        <stop offset="1" stop-color="#0d0b12" stop-opacity=".15"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#shade)"/>
    <text x="72" y="205" fill="#f7f1ff" font-size="92" font-family="Georgia" font-weight="700">RoleMate</text>
    <text x="76" y="272" fill="#d3c4f5" font-size="31" font-family="Arial">Анонимный поиск со-ролевиков</text>
    <line x1="76" y1="315" x2="350" y2="315" stroke="#9d7be5" stroke-width="3"/>
    <text x="76" y="545" fill="#b6a9c7" font-size="23" font-family="Arial">При поддержке @piarchaticksss</text>
  </svg>
`);

await sharp(source)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .composite([{ input: overlay }])
  .webp({ quality: 88, effort: 5 })
  .toFile(path.join(generated, 'rolemate-social-card.webp'));

console.log('Generated optimized RoleMate assets.');
