import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Minimal ustar writer: enough for a flat plugin folder (Tesserae widget install wants a gzip tarball). */
function tarHeader(name: string, size: number): Buffer {
	const h = Buffer.alloc(512, 0);
	h.write(name, 0, 100, 'utf8');
	h.write('0000644\0', 100, 8, 'ascii');
	h.write('0000000\0', 108, 8, 'ascii');
	h.write('0000000\0', 116, 8, 'ascii');
	h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
	h.write('00000000000\0', 136, 12, 'ascii');
	h.write('        ', 148, 8, 'ascii');
	h.write('0', 156, 1, 'ascii');
	h.write('ustar\0', 257, 6, 'ascii');
	h.write('00', 263, 2, 'ascii');
	let sum = 0;
	for (const b of h) sum += b;
	h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
	return h;
}

export function packWidget(dir: string, id = path.basename(dir)): Uint8Array {
	const parts: Buffer[] = [];
	for (const file of fs.readdirSync(dir).sort()) {
		const full = path.join(dir, file);
		if (!fs.statSync(full).isFile() || file.startsWith('.')) continue;
		const data = fs.readFileSync(full);
		parts.push(tarHeader(`${id}/${file}`, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
	}
	parts.push(Buffer.alloc(1024, 0));
	return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

export function widgetVersion(dir: string): string {
	return (JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as { version: string }).version;
}
