import { GlobalRegistrator } from '@happy-dom/global-registrator';
import "@testing-library/jest-dom";

GlobalRegistrator.register();

// Ensure a minimal Web Crypto API is available for tests (used by tauri mocks and other modules).
// Prefer existing `crypto` (Bun/Node), otherwise try Node's `crypto.randomFillSync`, otherwise fallback to Math.random.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.getRandomValues !== 'function') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const nodeCrypto = require('crypto');
    if (nodeCrypto && typeof nodeCrypto.randomFillSync === 'function') {
      // Provide a minimal bridge that matches the `crypto.getRandomValues(typedArray)` contract
      (globalThis as any).crypto = {
        getRandomValues: (arr: Uint8Array) => {
          nodeCrypto.randomFillSync(arr);
          return arr;
        },
        // expose subtle if available (Node 16+ via webcrypto)
        subtle: nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle ? nodeCrypto.webcrypto.subtle : undefined,
      } as unknown as Crypto;
    } else {
      throw new Error('no node crypto available');
    }
  } catch {
    // Fallback: non-cryptographic but good enough for tests
    (globalThis as any).crypto = {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    } as unknown as Crypto;
  }
}

// Mirror onto window (Happy DOM attaches a window global)
if (typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).window.crypto === 'undefined') {
  (globalThis as any).window.crypto = (globalThis as any).crypto;
}
