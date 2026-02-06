import type { SeekableReadableStream } from '../../src/drive';

// Minimal in-memory seekable stream and downloader useful for tests.
export function createSeekableStream(data: Uint8Array) {
  let pos = 0;
  const stream = new ReadableStream<Uint8Array>({
    start() {},
    pull(controller) {
      // Not used for ranged reads
      controller.close();
    },
  }) as SeekableReadableStream & { _inspect?: { lastSeek?: number; readCalls?: number[] } };

  stream._inspect = { lastSeek: undefined, readCalls: [] };

  stream.seek = async (offset: number) => {
    pos = Math.max(0, Math.min(offset, data.length));
    stream._inspect!.lastSeek = pos;
  };

  stream.read = async (numBytes: number) => {
    stream._inspect!.readCalls!.push(numBytes);
    if (pos >= data.length) {
      return { value: new Uint8Array(0), done: true };
    }
    const end = Math.min(pos + numBytes, data.length);
    const chunk = data.slice(pos, end);
    pos = end;
    const done = pos >= data.length;
    return { value: chunk, done };
  };

  return stream;
}

export function createFileDownloader(data: Uint8Array) {
  const seekable = createSeekableStream(data);
  const downloader: any = {
    getSeekableStream: () => seekable,
    downloadToStream: (writable: WritableStream) => {
      const writer = writable.getWriter();
      const writePromise = writer.write(data).then(() => writer.close());
      return {
        abort: () => {},
        pause: () => {},
        resume: () => {},
        completion: () => writePromise,
        isDownloadCompleteWithSignatureIssues: () => false,
      };
    },
    _seekable: seekable,
  };
  return downloader as {
    getSeekableStream: () => SeekableReadableStream;
    downloadToStream: (w: WritableStream) => any;
    _seekable: SeekableReadableStream;
  };
}
