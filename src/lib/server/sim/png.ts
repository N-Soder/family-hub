import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td) >>> 0);
	return Buffer.concat([len, td, crc]);
}

/** Encode an 8-bit greyscale image as PNG. */
export function encodeGrayPng(pixels: Uint8Array, w: number, h: number): Buffer {
	const raw = Buffer.alloc((w + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w + 1)] = 0;
		raw.set(pixels.subarray(y * w, y * w + w), y * (w + 1) + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // greyscale
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 1 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}
