/**
 * Pasted images, shrunk until they fit. A save travels through a Vercel
 * function, which takes 4.5 MB at most, so a phone photo cannot go as it is.
 * Small images (screenshots, mostly) are kept byte for byte; big ones are
 * redrawn at most 2560 px on the long side, WebP where the browser can encode
 * it and JPEG where it cannot.
 */
import type { Bytes } from '../lib/crypto.ts';

const KEEP_AS_IS = 1.5 * 1024 * 1024;
const LIMIT = 3.5 * 1024 * 1024;
const KEEPABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File): Promise<{ bytes: Bytes; type: string; name: string }> {
    if (file.size <= KEEP_AS_IS && KEEPABLE.includes(file.type)) {
        return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, name: file.name };
    }
    const bitmap = await createImageBitmap(file);
    let edge = 2560;
    let quality = 0.86;
    for (let attempt = 0; attempt < 5; attempt++) {
        const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let blob = await toBlob(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
        if (blob && blob.size <= LIMIT) {
            bitmap.close();
            const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
            return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type, name: file.name.replace(/\.[^.]+$/, '') + '.' + ext };
        }
        edge = Math.round(edge * 0.75);
        quality -= 0.08;
    }
    bitmap.close();
    throw new Error('This image is too large even after shrinking it');
}

/**
 * A photo for a model. Always redrawn, never sent as is: 1568 px on the long
 * side is what vision models work at anyway (more costs tokens and buys
 * nothing), and redrawing onto a canvas drops every byte of metadata. A phone
 * photo's EXIF carries where and when it was taken and on which device; none
 * of that reaches the provider or the vault.
 */
export async function prepareForModel(file: File): Promise<{ bytes: Bytes; type: string }> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`${file.name || 'This image'} cannot be read by this browser. Try a JPEG or PNG.`);
    }
    const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    // JPEG has no transparency: put a white page under it rather than black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await toBlob(canvas, 'image/jpeg', 0.85);
    if (!blob) throw new Error('The image could not be encoded');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' };
}
