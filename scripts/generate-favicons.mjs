import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const inputSvg = fileURLToPath(new URL('../public/favicon.svg', import.meta.url));
const outDir = fileURLToPath(new URL('../public', import.meta.url));

const pngSizes = [
  { size: 16, file: 'favicon-16x16.png' },
  { size: 32, file: 'favicon-32x32.png' },
  { size: 180, file: 'apple-touch-icon.png' },
];

await mkdir(outDir, { recursive: true });

// Note: sharp svg->png support depends on build configuration.
// If this fails in your environment, we should add a fallback svg->png renderer.
for (const { size, file } of pngSizes) {
  await sharp(inputSvg)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${outDir}/${file}`);
}

// ICO generation: use 32x32 as the source icon.
// Note: sharp does not support generating .ico in this environment.
// We generate the PNG variants which are sufficient for most browsers and many crawlers.

// Basic web manifest so browsers can discover icons.
const manifest = {
  name: 'Egor Fedorov',
  short_name: 'Egor Fedorov',
  start_url: '/',
  display: 'standalone',
  background_color: '#f2f1ec',
  theme_color: '#f2f1ec',
  icons: [
    { src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  ],
};

await writeFile(`${outDir}/site.webmanifest`, JSON.stringify(manifest, null, 2), 'utf8');

console.log('Favicons generated');

