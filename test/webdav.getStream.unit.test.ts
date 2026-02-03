import { describe, it, expect } from 'bun:test';
import ProtonDriveResource from '../src/webdav/ProtonDriveResource.js';
import { createFileDownloader } from './utils/seekableMock';

const gatherStreamData = async (stream: NodeJS.ReadableStream | any) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(new TextEncoder().encode(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      chunks.push(new Uint8Array(chunk));
    }
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const res = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    res.set(c, offset);
    offset += c.length;
  }
  return res;
};

describe('ProtonDriveResource.getStream', () => {
  it('performs ranged reads using seek/read', async () => {
    const data = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz');
    const downloader = createFileDownloader(data);

    const adapter: any = {
      driveClient: {
        getFileDownloader: async () => downloader,
      },
    };

    const node = {
      uid: 'node1',
      name: 'file.txt',
      type: 'file',
      size: data.length,
      mimeType: 'application/octet-stream',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root',
    } as const;

    const res = new ProtonDriveResource({ adapter, baseUrl: new URL('http://127.0.0.1'), path: '/file.txt', node });

    const stream = await res.getStream({ start: 5, end: 9 });
    const result = await gatherStreamData(stream);

    expect(new TextDecoder().decode(result)).toBe('fghij');

    // Ensure the underlying seekable stream was asked to seek to the correct offset
    // The helper stores inspect metadata at _seekable._inspect
    expect((downloader as any)._seekable._inspect.lastSeek).toBe(5);
  });

  it('performs full download and seeks to 0', async () => {
    const data = new TextEncoder().encode('HELLO WORLD');
    const downloader = createFileDownloader(data);

    const adapter: any = {
      driveClient: {
        getFileDownloader: async () => downloader,
      },
    };

    const node = {
      uid: 'node2',
      name: 'big.txt',
      type: 'file',
      size: data.length,
      mimeType: 'application/octet-stream',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root',
    } as const;

    const res = new ProtonDriveResource({ adapter, baseUrl: new URL('http://127.0.0.1'), path: '/big.txt', node });

    const stream = await res.getStream();
    const result = await gatherStreamData(stream);

    expect(new TextDecoder().decode(result)).toBe('HELLO WORLD');
    expect((downloader as any)._seekable._inspect.lastSeek).toBe(0);
  });
});
