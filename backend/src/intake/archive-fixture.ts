import { createGzip, gzipSync, gunzipSync } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { pack as createTarPack, type Header } from 'tar-stream';

export interface ArchiveFixtureEntry {
  name: string;
  content?: string | Uint8Array;
  type?: 'file' | 'directory' | 'symlink' | 'link' | 'fifo' | 'block-device' | 'character-device';
  linkname?: string;
  pax?: Record<string, string>;
}

export async function createTarGzFixture(entries: readonly ArchiveFixtureEntry[]): Promise<Uint8Array> {
  const pack = createTarPack();
  for (const entry of entries) {
    const type = entry.type ?? 'file';
    const header: Partial<Header> & Pick<Header, 'name'> = { name: entry.name, type };
    if (entry.linkname !== undefined) header.linkname = entry.linkname;
    if (entry.pax !== undefined) header.pax = entry.pax;
    if (type === 'file') {
      const content = typeof entry.content === 'string' ? Buffer.from(entry.content) : Buffer.from(entry.content ?? new Uint8Array());
      pack.entry(header, content);
    } else {
      pack.entry(header);
    }
  }
  pack.finalize();

  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  await pipeline(pack, createGzip(), sink);
  return Buffer.concat(chunks);
}

export const createArchiveFixture = createTarGzFixture;

export function truncatedArchiveFixture(archive: Uint8Array, removeBytes = 1): Uint8Array {
  const amount = Math.max(1, Math.min(removeBytes, archive.byteLength));
  return archive.slice(0, archive.byteLength - amount);
}

export function malformedGzipFixture(): Uint8Array {
  return Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00]);
}

export async function malformedTarHeaderFixture(): Promise<Uint8Array> {
  const archive = await createTarGzFixture([{ name: 'root/file.txt', content: 'payload' }]);
  const tar = Buffer.from(gunzipSync(archive));
  tar[148] ^= 0xff;
  return gzipSync(tar);
}

export async function truncatedTarFixture(archive: Uint8Array, removeBytes = 512): Promise<Uint8Array> {
  const tar = Buffer.from(gunzipSync(archive));
  const amount = Math.max(1, Math.min(removeBytes, tar.byteLength));
  return gzipSync(tar.subarray(0, tar.byteLength - amount));
}

export async function maliciousPaxFixture(pathValue = '../../escape.txt'): Promise<Uint8Array> {
  return createTarGzFixture([{ name: 'root/safe.txt', type: 'file', content: 'payload', pax: { path: pathValue } }]);
}

export function mutateTarFixture(archive: Uint8Array, mutate: (tar: Buffer) => Buffer | void): Uint8Array {
  const tar = Buffer.from(gunzipSync(archive));
  return gzipSync(mutate(tar) ?? tar);
}

/** Change a raw header while retaining a valid checksum, for rejection fixtures. */
export function rewriteTarHeader(tar: Buffer, values: { type?: string; size?: number }, offset = 0): void {
  if (values.type !== undefined) tar.write(values.type, offset + 156, 1, 'ascii');
  if (values.size !== undefined) tar.write(`${values.size.toString(8).padStart(11, '0')}\0`, offset + 124, 12, 'ascii');
  tar.fill(0x20, offset + 148, offset + 156);
  let checksum = 0;
  for (const byte of tar.subarray(offset, offset + 512)) checksum += byte;
  tar.write(`${checksum.toString(8).padStart(6, '0')}\0 `, offset + 148, 8, 'ascii');
}
