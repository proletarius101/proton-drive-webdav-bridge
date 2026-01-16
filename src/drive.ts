/**
 * Proton Drive Bridge - Drive Client
 *
 * Wrapper for @protontech/drive-sdk providing file operations for the WebDAV server.
 * Handles authentication, file listing, reading, writing, and deletion.
 */

import { ProtonAuth, restoreSessionFromStorage, type Session, openpgp } from './auth.js';
import { logger } from './logger.js';
import { deleteStoredCredentials, storeCredentials, type StoredCredentials } from './keychain.js';

// ============================================================================
// Types
// ============================================================================

export interface DriveNode {
  uid: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  mimeType: string;
  createdTime: Date;
  modifiedTime: Date;
  parentUid: string | null;
}

export interface NodeResult {
  ok: boolean;
  value?: {
    uid: string;
    name: string;
    type: string;
    mediaType?: string;
    creationTime: Date;
    modificationTime: Date;
    activeRevision?: {
      claimedSize?: number;
      storageSize: number;
      claimedModificationTime?: Date;
    };
    folder?: {
      claimedModificationTime?: Date;
    };
  };
  error?: unknown;
}

export interface RootFolderResult {
  ok: boolean;
  value?: { uid: string };
  error?: unknown;
}

export interface CreateFolderResult {
  ok: boolean;
  value?: { uid: string };
  error?: unknown;
}

export interface DeleteResult {
  ok: boolean;
  error?: unknown;
}

export interface UploadMetadata {
  mediaType: string;
  expectedSize: number;
  modificationTime?: Date;
  overrideExistingDraftByOtherClient?: boolean;
}

export interface UploadController {
  pause(): void;
  resume(): void;
  completion(): Promise<{ nodeUid: string; nodeRevisionUid: string }>;
}

export interface FileUploader {
  getAvailableName(): Promise<string>;
  uploadFromStream(
    stream: ReadableStream,
    thumbnails: [],
    onProgress?: (uploadedBytes: number) => void
  ): Promise<UploadController>;
}

export interface FileRevisionUploader {
  uploadFromStream(
    stream: ReadableStream,
    thumbnails: [],
    onProgress?: (uploadedBytes: number) => void
  ): Promise<UploadController>;
}

export interface FileDownloader {
  downloadToStream(): Promise<ReadableStream<Uint8Array>>;
}

// SDK client interface
export interface ProtonDriveClient {
  iterateFolderChildren(folderUid: string): AsyncIterable<NodeResult>;
  getMyFilesRootFolder(): Promise<RootFolderResult>;
  createFolder(
    parentNodeUid: string,
    name: string,
    modificationTime?: Date
  ): Promise<CreateFolderResult>;
  getFileUploader(
    parentFolderUid: string,
    name: string,
    metadata: UploadMetadata,
    signal?: AbortSignal
  ): Promise<FileUploader>;
  getFileRevisionUploader(
    nodeUid: string,
    metadata: UploadMetadata,
    signal?: AbortSignal
  ): Promise<FileRevisionUploader>;
  trashNodes(nodeUids: string[]): AsyncIterable<DeleteResult>;
  deleteNodes(nodeUids: string[]): AsyncIterable<DeleteResult>;
  renameNode(nodeUid: string, newName: string): Promise<NodeResult>;
  moveNodes(
    nodeUids: string[],
    newParentNodeUid: string,
    signal?: AbortSignal
  ): AsyncIterable<NodeResult>;
  getFileDownloader(nodeUid: string): Promise<FileDownloader>;
}

// ============================================================================
// SDK Integration Types
// ============================================================================

interface SessionKey {
  data: Uint8Array;
  algorithm: string;
}

interface OwnAddress {
  email: string;
  addressId: string;
  primaryKeyIndex: number;
  keys: { id: string; key: openpgp.PrivateKey }[];
}

interface ProtonAccount {
  getOwnPrimaryAddress(): Promise<OwnAddress>;
  getOwnAddress(emailOrAddressId: string): Promise<OwnAddress>;
  hasProtonAccount(email: string): Promise<boolean>;
  getPublicKeys(email: string): Promise<openpgp.PublicKey[]>;
}

interface HttpClientRequest {
  url: string;
  method: string;
  headers: Headers;
  json?: Record<string, unknown>;
  body?: ArrayBuffer | Uint8Array | string | ReadableStream | null;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface ProtonHttpClient {
  fetchJson(request: HttpClientRequest): Promise<Response>;
  fetchBlob(request: HttpClientRequest): Promise<Response>;
}

interface SRPModuleInterface {
  getSrp(
    version: number,
    modulus: string,
    serverEphemeral: string,
    salt: string,
    password: string
  ): Promise<{ clientEphemeral: string; clientProof: string; expectedServerProof: string }>;
  getSrpVerifier(
    password: string
  ): Promise<{ modulusId: string; version: number; salt: string; verifier: string }>;
  computeKeyPassword(password: string, salt: string): Promise<string>;
}

interface OpenPGPCryptoInterface {
  // Key and passphrase generation
  generatePassphrase(): string;
  generateKey(passphrase: string): Promise<openpgp.PrivateKey>;
  generateSessionKey(encryptionKeys: openpgp.PublicKey[]): Promise<SessionKey>;

  // Session key operations
  encryptSessionKey(
    sessionKey: SessionKey,
    encryptionKeys: openpgp.PublicKey | openpgp.PublicKey[]
  ): Promise<{ keyPacket: Uint8Array }>;
  encryptSessionKeyWithPassword(sessionKey: SessionKey, password: string): Promise<Uint8Array>;
  decryptSessionKey(
    keyPacket: Uint8Array,
    decryptionKeys: openpgp.PrivateKey | openpgp.PrivateKey[]
  ): Promise<SessionKey>;
  decryptArmoredSessionKey(
    armoredData: string,
    decryptionKeys: openpgp.PrivateKey | openpgp.PrivateKey[]
  ): Promise<SessionKey>;

  // Key decryption
  decryptKey(armoredKey: string, passphrase: string): Promise<openpgp.PrivateKey>;

  // Encryption operations
  encryptArmored(
    data: Uint8Array,
    encryptionKeys: openpgp.PublicKey[],
    sessionKey?: SessionKey
  ): Promise<{ armoredData: string }>;
  encryptAndSignArmored(
    data: Uint8Array,
    sessionKey: SessionKey | undefined,
    encryptionKeys: openpgp.PublicKey[],
    signingKey: openpgp.PrivateKey
  ): Promise<{ armoredData: string }>;
  encryptAndSign(
    data: Uint8Array,
    sessionKey: SessionKey,
    encryptionKeys: openpgp.PublicKey[],
    signingKey: openpgp.PrivateKey
  ): Promise<{ encryptedData: Uint8Array }>;
  encryptAndSignDetached(
    data: Uint8Array,
    sessionKey: SessionKey,
    encryptionKeys: openpgp.PublicKey[],
    signingKey: openpgp.PrivateKey
  ): Promise<{ encryptedData: Uint8Array; signature: Uint8Array }>;
  encryptAndSignDetachedArmored(
    data: Uint8Array,
    sessionKey: SessionKey | undefined,
    encryptionKeys: openpgp.PublicKey[],
    signingKey: openpgp.PrivateKey
  ): Promise<{ armoredData: string; armoredSignature: string }>;

  // Decryption operations
  decryptArmored(armoredData: string, decryptionKeys: openpgp.PrivateKey[]): Promise<Uint8Array>;
  decryptArmoredWithPassword(armoredData: string, password: string): Promise<Uint8Array>;
  decryptArmoredAndVerify(
    armoredData: string,
    decryptionKeys: openpgp.PrivateKey[],
    verificationKeys: openpgp.PublicKey[]
  ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }>;
  decryptArmoredAndVerifyDetached(
    armoredData: string,
    armoredSignature: string,
    sessionKey: SessionKey,
    verificationKeys: openpgp.PublicKey[]
  ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }>;
  decryptAndVerify(
    encryptedData: Uint8Array,
    sessionKey: SessionKey,
    verificationKeys: openpgp.PublicKey[]
  ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }>;

  // Signing operations
  sign(
    data: Uint8Array,
    signingKey: openpgp.PrivateKey | openpgp.PrivateKey[],
    context?: string
  ): Promise<{ signature: Uint8Array }>;
  signArmored(
    data: Uint8Array,
    signingKey: openpgp.PrivateKey | openpgp.PrivateKey[]
  ): Promise<{ signature: string }>;

  // Verification operations
  verifyArmored(
    data: Uint8Array,
    armoredSignature: string,
    verificationKeys: openpgp.PublicKey[],
    context?: string
  ): Promise<{ verified: number; verificationErrors?: Error[] }>;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE_URL = 'https://api.protonmail.ch';
const PLATFORM_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows' };
const PLATFORM = PLATFORM_MAP[process.platform] ?? 'macos';
const APP_VERSION =
  PLATFORM === 'windows' ? `${PLATFORM}-drive@1.12.4` : `${PLATFORM}-drive@2.10.1`;

// ============================================================================
// SDK Helpers
// ============================================================================

function toArray<T>(val: T | T[]): T[] {
  return Array.isArray(val) ? val : [val];
}

/**
 * Create an HTTP client for the Proton Drive SDK
 */
function createProtonHttpClient(
  session: Session,
  onTokenRefresh?: () => Promise<void>
): ProtonHttpClient {
  const buildUrl = (url: string): string => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${API_BASE_URL}/${url}`;
  };

  const setAuthHeaders = (headers: Headers) => {
    if (session.UID) {
      headers.set('x-pm-uid', session.UID);
    }
    if (session.AccessToken) {
      headers.set('Authorization', `Bearer ${session.AccessToken}`);
    }
    headers.set('x-pm-appversion', APP_VERSION);
  };

  return {
    async fetchJson(request: HttpClientRequest): Promise<Response> {
      const { url, method, headers, json, timeoutMs, signal } = request;
      setAuthHeaders(headers);

      const fullUrl = buildUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response = await fetch(fullUrl, {
          method,
          headers,
          body: json ? JSON.stringify(json) : undefined,
          signal: signal || controller.signal,
        });

        if (response.status === 401 && session.RefreshToken && onTokenRefresh) {
          try {
            await onTokenRefresh();
            setAuthHeaders(headers);
            response = await fetch(fullUrl, {
              method,
              headers,
              body: json ? JSON.stringify(json) : undefined,
              signal: signal || controller.signal,
            });
          } catch (error) {
            // Log refresh failure but continue
            logger.debug(`Credential refresh failed: ${error}`);
          }
        }

        return response;
      } finally {
        clearTimeout(timeout);
      }
    },

    async fetchBlob(request: HttpClientRequest): Promise<Response> {
      const { url, method, headers, body, timeoutMs, signal } = request;
      setAuthHeaders(headers);

      const fullUrl = buildUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response = await fetch(fullUrl, {
          method,
          headers,
          body,
          signal: signal || controller.signal,
        });

        if (response.status === 401 && session.RefreshToken && onTokenRefresh) {
          try {
            await onTokenRefresh();
            setAuthHeaders(headers);
            response = await fetch(fullUrl, {
              method,
              headers,
              body,
              signal: signal || controller.signal,
            });
          } catch (error) {
            // Log refresh failure but continue
            logger.debug(`Credential refresh failed: ${error}`);
          }
        }

        return response;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Create a Proton account interface for the SDK
 */
function createProtonAccount(
  session: Session,
  cryptoModule: OpenPGPCryptoInterface,
  httpClient: ProtonHttpClient
): ProtonAccount {
  const decryptedKeysCache = new Map<string, openpgp.PrivateKey>();

  async function decryptAddressKeys(
    keys: { ID: string; Primary: number; armoredKey: string; passphrase: string }[]
  ): Promise<{ id: string; key: openpgp.PrivateKey }[]> {
    const result: { id: string; key: openpgp.PrivateKey }[] = [];
    for (const k of keys) {
      let decryptedKey = decryptedKeysCache.get(k.ID);
      if (!decryptedKey) {
        decryptedKey = await cryptoModule.decryptKey(k.armoredKey, k.passphrase);
        decryptedKeysCache.set(k.ID, decryptedKey);
      }
      result.push({ id: k.ID, key: decryptedKey });
    }
    return result;
  }

  return {
    async getOwnPrimaryAddress(): Promise<OwnAddress> {
      const primaryAddress = session.addresses?.find((a) => a.Type === 1 && a.Status === 1);
      if (!primaryAddress) {
        throw new Error('No primary address found');
      }

      const primaryKeyIndex = primaryAddress.keys.findIndex((k) => k.Primary === 1);
      const keys = await decryptAddressKeys(primaryAddress.keys);
      return {
        email: primaryAddress.Email,
        addressId: primaryAddress.ID,
        primaryKeyIndex: primaryKeyIndex >= 0 ? primaryKeyIndex : 0,
        keys,
      };
    },

    async getOwnAddress(emailOrAddressId: string): Promise<OwnAddress> {
      const address = session.addresses?.find(
        (a) => a.Email === emailOrAddressId || a.ID === emailOrAddressId
      );
      if (!address) {
        throw new Error(`Address not found: ${emailOrAddressId}`);
      }

      const primaryKeyIndex = address.keys.findIndex((k) => k.Primary === 1);
      const keys = await decryptAddressKeys(address.keys);
      return {
        email: address.Email,
        addressId: address.ID,
        primaryKeyIndex: primaryKeyIndex >= 0 ? primaryKeyIndex : 0,
        keys,
      };
    },

    async hasProtonAccount(email: string): Promise<boolean> {
      // Query the key transparency endpoint to check if the email has a Proton account
      try {
        const response = await httpClient.fetchJson({
          url: `core/v4/keys?Email=${encodeURIComponent(email)}`,
          method: 'GET',
          headers: new Headers(),
          timeoutMs: 10000,
        });
        const json = (await response.json()) as Record<string, unknown> & { Keys?: unknown[] };
        return json.Keys !== undefined && json.Keys.length > 0;
      } catch {
        return false;
      }
    },

    async getPublicKeys(email: string): Promise<openpgp.PublicKey[]> {
      try {
        const response = await httpClient.fetchJson({
          url: `core/v4/keys?Email=${encodeURIComponent(email)}`,
          method: 'GET',
          headers: new Headers(),
          timeoutMs: 10000,
        });
        interface KeysResponse {
          Keys?: Array<{ PublicKey: string }>;
        }
        const json = (await response.json()) as Record<string, unknown> & KeysResponse;

        const keys: openpgp.PublicKey[] = [];
        for (const keyData of json.Keys || []) {
          try {
            const key = await openpgp.readKey({ armoredKey: keyData.PublicKey });
            keys.push(key);
          } catch {
            // Skip invalid keys
          }
        }
        return keys;
      } catch {
        return [];
      }
    },
  };
}

/**
 * Create an OpenPGP crypto wrapper for the SDK
 */
function createOpenPGPCrypto(): OpenPGPCryptoInterface {
  function base64Encode(arr: Uint8Array): string {
    return btoa(String.fromCharCode(...arr));
  }

  return {
    // ========================================================================
    // Key and passphrase generation
    // ========================================================================

    generatePassphrase(): string {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return base64Encode(bytes);
    },

    async generateKey(passphrase: string): Promise<openpgp.PrivateKey> {
      const { privateKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519Legacy',
        userIDs: [{ name: 'Proton Drive', email: 'drive@proton.me' }],
        passphrase,
        format: 'object',
      });
      return privateKey;
    },

    async generateSessionKey(encryptionKeys: openpgp.PublicKey[]): Promise<SessionKey> {
      return (await openpgp.generateSessionKey({
        encryptionKeys: toArray(encryptionKeys),
      })) as SessionKey;
    },

    // ========================================================================
    // Session key operations
    // ========================================================================

    async encryptSessionKey(
      sessionKey: SessionKey,
      encryptionKeys: openpgp.PublicKey | openpgp.PublicKey[]
    ): Promise<{ keyPacket: Uint8Array }> {
      const result = await openpgp.encryptSessionKey({
        data: sessionKey.data,
        algorithm: sessionKey.algorithm,
        encryptionKeys: toArray(encryptionKeys),
        format: 'binary',
      });
      return { keyPacket: result as Uint8Array };
    },

    async encryptSessionKeyWithPassword(
      sessionKey: SessionKey,
      password: string
    ): Promise<Uint8Array> {
      const result = await openpgp.encryptSessionKey({
        data: sessionKey.data,
        algorithm: sessionKey.algorithm,
        passwords: [password],
        format: 'binary',
      });
      return result as Uint8Array;
    },

    async decryptSessionKey(
      keyPacket: Uint8Array,
      decryptionKeys: openpgp.PrivateKey | openpgp.PrivateKey[]
    ): Promise<SessionKey> {
      const message = await openpgp.readMessage({ binaryMessage: keyPacket });
      const result = await openpgp.decryptSessionKeys({
        message,
        decryptionKeys: toArray(decryptionKeys),
      });
      if (!result || result.length === 0) {
        throw new Error('Could not decrypt session key');
      }
      return result[0] as SessionKey;
    },

    async decryptArmoredSessionKey(
      armoredData: string,
      decryptionKeys: openpgp.PrivateKey | openpgp.PrivateKey[]
    ): Promise<SessionKey> {
      const message = await openpgp.readMessage({ armoredMessage: armoredData });
      const result = await openpgp.decryptSessionKeys({
        message,
        decryptionKeys: toArray(decryptionKeys),
      });

      if (!result || result.length === 0) {
        throw new Error('Could not decrypt session key');
      }

      return result[0] as SessionKey;
    },

    // ========================================================================
    // Key decryption
    // ========================================================================

    async decryptKey(armoredKey: string, passphrase: string): Promise<openpgp.PrivateKey> {
      const privateKey = await openpgp.readPrivateKey({ armoredKey });
      const decrypted = await openpgp.decryptKey({ privateKey, passphrase });
      return decrypted;
    },

    // ========================================================================
    // Encryption operations
    // ========================================================================

    async encryptArmored(
      data: Uint8Array,
      encryptionKeys: openpgp.PublicKey[],
      sessionKey?: SessionKey
    ): Promise<{ armoredData: string }> {
      const message = await openpgp.createMessage({ binary: data });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        sessionKey: sessionKey
          ? {
              data: sessionKey.data,
              algorithm: sessionKey.algorithm,
            }
          : undefined,
        format: 'armored',
      });
      return { armoredData: encrypted as string };
    },

    async encryptAndSignArmored(
      data: Uint8Array,
      sessionKey: SessionKey | undefined,
      encryptionKeys: openpgp.PublicKey[],
      signingKey: openpgp.PrivateKey
    ): Promise<{ armoredData: string }> {
      const message = await openpgp.createMessage({ binary: data });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        signingKeys: [signingKey],
        sessionKey: sessionKey
          ? {
              data: sessionKey.data,
              algorithm: sessionKey.algorithm,
            }
          : undefined,
        format: 'armored',
      });
      return { armoredData: encrypted as string };
    },

    async encryptAndSign(
      data: Uint8Array,
      sessionKey: SessionKey,
      encryptionKeys: openpgp.PublicKey[],
      signingKey: openpgp.PrivateKey
    ): Promise<{ encryptedData: Uint8Array }> {
      const message = await openpgp.createMessage({ binary: data });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        signingKeys: [signingKey],
        sessionKey: {
          data: sessionKey.data,
          algorithm: sessionKey.algorithm,
        },
        format: 'binary',
      });
      return { encryptedData: encrypted as Uint8Array };
    },

    async encryptAndSignDetached(
      data: Uint8Array,
      sessionKey: SessionKey,
      encryptionKeys: openpgp.PublicKey[],
      signingKey: openpgp.PrivateKey
    ): Promise<{ encryptedData: Uint8Array; signature: Uint8Array }> {
      const message = await openpgp.createMessage({ binary: data });
      const [encrypted, signature] = await Promise.all([
        openpgp.encrypt({
          message,
          encryptionKeys,
          sessionKey: {
            data: sessionKey.data,
            algorithm: sessionKey.algorithm,
          },
          format: 'binary',
        }),
        openpgp.sign({
          message,
          signingKeys: [signingKey],
          format: 'binary',
          detached: true,
        }),
      ]);
      return { encryptedData: encrypted as Uint8Array, signature: signature as Uint8Array };
    },

    async encryptAndSignDetachedArmored(
      data: Uint8Array,
      sessionKey: SessionKey | undefined,
      encryptionKeys: openpgp.PublicKey[],
      signingKey: openpgp.PrivateKey
    ): Promise<{ armoredData: string; armoredSignature: string }> {
      const message = await openpgp.createMessage({ binary: data });
      const [encrypted, signature] = await Promise.all([
        openpgp.encrypt({
          message,
          encryptionKeys,
          sessionKey: sessionKey
            ? {
                data: sessionKey.data,
                algorithm: sessionKey.algorithm,
              }
            : undefined,
          format: 'armored',
        }),
        openpgp.sign({
          message,
          signingKeys: [signingKey],
          format: 'armored',
          detached: true,
        }),
      ]);
      return { armoredData: encrypted as string, armoredSignature: signature as string };
    },

    // ========================================================================
    // Decryption operations
    // ========================================================================

    async decryptArmored(
      armoredData: string,
      decryptionKeys: openpgp.PrivateKey[]
    ): Promise<Uint8Array> {
      const message = await openpgp.readMessage({ armoredMessage: armoredData });
      const { data } = await openpgp.decrypt({
        message,
        decryptionKeys,
        format: 'binary',
      });
      return data as Uint8Array;
    },

    async decryptArmoredWithPassword(armoredData: string, password: string): Promise<Uint8Array> {
      const message = await openpgp.readMessage({ armoredMessage: armoredData });
      const { data } = await openpgp.decrypt({
        message,
        passwords: [password],
        format: 'binary',
      });
      return data as Uint8Array;
    },

    async decryptArmoredAndVerify(
      armoredData: string,
      decryptionKeys: openpgp.PrivateKey[],
      verificationKeys: openpgp.PublicKey[]
    ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }> {
      const message = await openpgp.readMessage({ armoredMessage: armoredData });
      const result = await openpgp.decrypt({
        message,
        decryptionKeys,
        verificationKeys: verificationKeys.length > 0 ? verificationKeys : undefined,
        format: 'binary',
      });

      let verified = 0;
      if (result.signatures?.length > 0) {
        const sigVerified = await result.signatures[0].verified.catch(() => false);
        verified = sigVerified ? 1 : 0;
      }

      return {
        data: result.data as Uint8Array,
        verified,
        verificationErrors: verified ? undefined : [new Error('Signature verification failed')],
      };
    },

    async decryptArmoredAndVerifyDetached(
      armoredData: string,
      armoredSignature: string,
      sessionKey: SessionKey,
      verificationKeys: openpgp.PublicKey[]
    ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }> {
      // Decrypt without verification first
      const message = await openpgp.readMessage({ armoredMessage: armoredData });
      const result = await openpgp.decrypt({
        message,
        sessionKeys: [
          {
            data: sessionKey.data,
            algorithm: sessionKey.algorithm,
          },
        ],
        format: 'binary',
      });

      // Then verify signature separately if provided
      let verified = 0;
      let verificationErrors: Error[] | undefined;
      if (armoredSignature && verificationKeys.length > 0) {
        try {
          const signature = await openpgp.readSignature({ armoredSignature });
          const verifyResult = await openpgp.verify({
            message: await openpgp.createMessage({ binary: result.data as Uint8Array }),
            signature,
            verificationKeys,
          });
          const sigVerified = await verifyResult.signatures[0]?.verified.catch(() => false);
          verified = sigVerified ? 1 : 0;
        } catch (error) {
          verified = 0;
          verificationErrors = [error as Error];
        }
      }

      return {
        data: result.data as Uint8Array,
        verified,
        verificationErrors,
      };
    },

    async decryptAndVerify(
      encryptedData: Uint8Array,
      sessionKey: SessionKey,
      verificationKeys: openpgp.PublicKey[]
    ): Promise<{ data: Uint8Array; verified: number; verificationErrors?: Error[] }> {
      const message = await openpgp.readMessage({ binaryMessage: encryptedData });
      const result = await openpgp.decrypt({
        message,
        sessionKeys: [
          {
            data: sessionKey.data,
            algorithm: sessionKey.algorithm,
          },
        ],
        verificationKeys: verificationKeys.length > 0 ? verificationKeys : undefined,
        format: 'binary',
      });

      let verified = 0;
      if (result.signatures?.length > 0) {
        const sigVerified = await result.signatures[0].verified.catch(() => false);
        verified = sigVerified ? 1 : 0;
      }

      return {
        data: result.data as Uint8Array,
        verified,
        verificationErrors: verified ? undefined : [new Error('Signature verification failed')],
      };
    },

    // ========================================================================
    // Signing operations
    // ========================================================================

    async sign(
      data: Uint8Array,
      signingKey: openpgp.PrivateKey | openpgp.PrivateKey[],
      _context?: string
    ): Promise<{ signature: Uint8Array }> {
      const message = await openpgp.createMessage({ binary: data });
      const signature = await openpgp.sign({
        message,
        signingKeys: toArray(signingKey),
        format: 'binary',
        detached: true,
        // context: context ? { value: context, critical: true } : undefined,
      });
      return { signature: signature as Uint8Array };
    },

    async signArmored(
      data: Uint8Array,
      signingKey: openpgp.PrivateKey | openpgp.PrivateKey[]
    ): Promise<{ signature: string }> {
      const message = await openpgp.createMessage({ binary: data });
      const signature = await openpgp.sign({
        message,
        signingKeys: toArray(signingKey),
        format: 'armored',
        detached: true,
      });
      return { signature: signature as string };
    },

    // ========================================================================
    // Verification operations
    // ========================================================================

    async verifyArmored(
      data: Uint8Array,
      armoredSignature: string,
      verificationKeys: openpgp.PublicKey[],
      _context?: string
    ): Promise<{ verified: number; verificationErrors?: Error[] }> {
      const [message, signature] = await Promise.all([
        openpgp.createMessage({ binary: data }),
        openpgp.readSignature({ armoredSignature }),
      ]);

      const result = await openpgp.verify({
        message,
        signature,
        verificationKeys,
        // context: context ? { value: context, critical: true } : undefined,
      });

      const verified = (await result.signatures?.[0]?.verified) ? 1 : 0;
      return {
        verified,
        verificationErrors: verified ? undefined : [new Error('Signature verification failed')],
      };
    },
  };
}

/**
 * Create an SRP module for the SDK
 * Note: This is a stub implementation since SRP is only needed for password operations
 */
function createSrpModule(): SRPModuleInterface {
  return {
    async getSrp(
      _version: number,
      _modulus: string,
      _serverEphemeral: string,
      _salt: string,
      _password: string
    ): Promise<{ clientEphemeral: string; clientProof: string; expectedServerProof: string }> {
      throw new Error('SRP operations not supported in WebDAV bridge');
    },

    async getSrpVerifier(
      _password: string
    ): Promise<{ modulusId: string; version: number; salt: string; verifier: string }> {
      throw new Error('SRP verifier generation not supported in WebDAV bridge');
    },

    async computeKeyPassword(_password: string, _salt: string): Promise<string> {
      throw new Error('Key password computation not supported in WebDAV bridge');
    },
  };
}

// ============================================================================
// Drive Client Manager
// ============================================================================

export class DriveClientManager {
  private auth: ProtonAuth | null = null;
  private session: Session | null = null;
  private client: ProtonDriveClient | null = null;
  private username: string | null = null;
  private rootFolderUid: string | null = null;
  private httpClient: ProtonHttpClient | null = null;

  /**
   * Initialize the client from stored credentials
   */
  async initialize(sdkDebug = false): Promise<void> {
    try {
      const result = await restoreSessionFromStorage();
      this.auth = result.auth;
      this.session = result.session;
      this.username = result.username;

      // Create the SDK client
      this.client = await this.createClient(sdkDebug);

      // Get root folder
      const rootFolder = await this.client.getMyFilesRootFolder();
      if (!rootFolder.ok || !rootFolder.value) {
        throw new Error(`Failed to get root folder: ${rootFolder.error}`);
      }
      this.rootFolderUid = rootFolder.value.uid;

      logger.info(`Initialized Drive client for ${this.username}`);
    } catch (error) {
      logger.error(`Failed to initialize Drive client: ${error}`);
      throw error;
    }
  }

  /**
   * Create the Proton Drive SDK client
   */
  private async createClient(sdkDebug = false): Promise<ProtonDriveClient> {
    if (!this.session || !this.auth) {
      throw new Error('No session available');
    }

    // Dynamic import of the SDK
    const sdk = await import('@protontech/drive-sdk');

    // Import telemetry module for logging configuration
    const telemetryModule = await import('@protontech/drive-sdk/dist/telemetry.js');

    const cryptoModule = createOpenPGPCrypto();
    const httpClient = createProtonHttpClient(this.session, async () => {
      if (!this.auth || !this.username) {
        throw new Error('Auth or username not initialized');
      }
      try {
        await this.auth.refreshToken();
        // Update stored credentials
        const newCreds = this.auth.getReusableCredentials();
        const storedCreds: StoredCredentials = {
          ...newCreds,
          username: this.username,
        };
        await storeCredentials(storedCreds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Authentication required')) {
          await deleteStoredCredentials();
        }
        throw error;
      }
    });

    // Store httpClient for direct API calls (pagination workaround)
    this.httpClient = httpClient;

    const account = createProtonAccount(this.session, cryptoModule, httpClient);
    const srpModule = createSrpModule();

    // Create telemetry with appropriate log level
    const logLevel = sdkDebug ? telemetryModule.LogLevel.DEBUG : telemetryModule.LogLevel.ERROR;
    const telemetry = new telemetryModule.Telemetry({
      logFilter: new telemetryModule.LogFilter({ globalLevel: logLevel }),
      logHandlers: [new telemetryModule.ConsoleLogHandler()],
      metricHandlers: [],
    });

    // Create the SDK client
    const client = new sdk.ProtonDriveClient({
      httpClient,
      entitiesCache: new sdk.MemoryCache(),
      cryptoCache: new sdk.MemoryCache(),
      // @ts-expect-error - PrivateKey types differ between openpgp imports
      account,
      // @ts-expect-error - PrivateKey types differ between openpgp imports
      openPGPCryptoModule: cryptoModule,
      srpModule,
      telemetry,
    });

    return client as unknown as ProtonDriveClient;
  }

  /**
   * Get the SDK client
   */
  getClient(): ProtonDriveClient {
    if (!this.client) {
      throw new Error('Client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Get root folder UID
   */
  getRootFolderUid(): string {
    if (!this.rootFolderUid) {
      throw new Error('Root folder not initialized');
    }
    return this.rootFolderUid;
  }

  /**
   * Get username
   */
  getUsername(): string | null {
    return this.username;
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.client !== null;
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  /**
   * List contents of a folder
   * Uses direct API with PageSize parameter to match WebClients implementation
   * and overcome SDK pagination limitation (default ~300-350 items per page)
   */
  async listFolder(folderUid: string): Promise<DriveNode[]> {
    const client = this.getClient();
    const nodes: DriveNode[] = [];

    // Use direct API call with explicit PageSize to get all children
    // This matches the WebClients pattern from packages/shared/lib/api/drive/folder.ts
    if (this.httpClient && folderUid.includes('~')) {
      try {
        const [volumeId, nodeId] = folderUid.split('~');
        const allChildUids: string[] = [];
        let anchor = '';
        const pageSize = 500; // Larger than WebClients' 150 for better performance

        // Fetch all child UIDs using pagination with PageSize
        while (true) {
          const queryParams = new URLSearchParams();
          queryParams.set('PageSize', pageSize.toString());
          if (anchor) {
            queryParams.set('AnchorID', anchor);
          }

          //   TODO: Switch to the SDK's built-in method once pagination limit is configurable
          const url = `drive/v2/volumes/${volumeId}/folders/${nodeId}/children?${queryParams.toString()}`;

          const response = await this.httpClient.fetchJson({
            url,
            method: 'GET',
            headers: new Headers(),
            timeoutMs: 30000,
          });

          if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = (await response.json()) as any;

          if (data.LinkIDs && Array.isArray(data.LinkIDs)) {
            allChildUids.push(...data.LinkIDs);
          }

          if (!data.More || !data.AnchorID) {
            break;
          }
          anchor = data.AnchorID;
        }

        logger.debug(
          `Fetched ${allChildUids.length} child UIDs via direct API for folder ${nodeId}`
        );

        // Fetch full node details from SDK (which has caching and decryption)
        const uidSet = new Set(allChildUids);
        for await (const result of client.iterateFolderChildren(folderUid)) {
          if (result.ok && result.value) {
            const node = result.value;
            const nodeId = node.uid.split('~')[1] || node.uid;
            if (uidSet.has(nodeId)) {
              const isFolder = node.type === 'folder';
              const size = isFolder
                ? 0
                : (node.activeRevision?.claimedSize ?? node.activeRevision?.storageSize ?? 0);
              const modifiedTime = isFolder
                ? (node.folder?.claimedModificationTime ??
                  node.modificationTime ??
                  node.creationTime)
                : (node.activeRevision?.claimedModificationTime ??
                  node.modificationTime ??
                  node.creationTime);

              nodes.push({
                uid: node.uid,
                name: node.name,
                type: isFolder ? 'folder' : 'file',
                size,
                mimeType: node.mediaType || 'application/octet-stream',
                createdTime: node.creationTime,
                modifiedTime,
                parentUid: folderUid,
              });
            }
          }
        }

        return nodes;
      } catch (error) {
        logger.warn(`Direct API pagination failed, falling back to SDK: ${error}`);
      }
    }

    // Fallback to SDK iteration (original behavior with default pagination limit)
    for await (const result of client.iterateFolderChildren(folderUid)) {
      if (result.ok && result.value) {
        const node = result.value;
        const isFolder = node.type === 'folder';
        const size = isFolder
          ? 0
          : (node.activeRevision?.claimedSize ?? node.activeRevision?.storageSize ?? 0);
        const modifiedTime = isFolder
          ? (node.folder?.claimedModificationTime ?? node.modificationTime ?? node.creationTime)
          : (node.activeRevision?.claimedModificationTime ??
            node.modificationTime ??
            node.creationTime);

        nodes.push({
          uid: node.uid,
          name: node.name,
          type: isFolder ? 'folder' : 'file',
          size,
          mimeType: node.mediaType || 'application/octet-stream',
          createdTime: node.creationTime,
          modifiedTime,
          parentUid: folderUid,
        });
      }
    }

    return nodes;
  }

  /**
   * Find a node by name in a folder
   */
  async findNodeByName(
    folderUid: string,
    name: string
  ): Promise<{ uid: string; type: string } | null> {
    const client = this.getClient();
    let found: { uid: string; type: string } | null = null;

    for await (const result of client.iterateFolderChildren(folderUid)) {
      if (!found && result.ok && result.value?.name === name) {
        found = { uid: result.value.uid, type: result.value.type };
      }
    }

    return found;
  }

  /**
   * Resolve a path to a node UID
   */
  async resolvePath(path: string): Promise<{ uid: string; type: string } | null> {
    const parts = path.split('/').filter((p) => p.length > 0);

    if (parts.length === 0) {
      return { uid: this.getRootFolderUid(), type: 'folder' };
    }

    let currentUid = this.getRootFolderUid();

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const node = await this.findNodeByName(currentUid, part);

      if (!node) {
        return null;
      }

      if (i < parts.length - 1 && node.type !== 'folder') {
        return null; // Path component is not a folder
      }

      currentUid = node.uid;
    }

    // Get the final node type
    const finalNode = await this.findNodeByName(
      currentUid === this.getRootFolderUid()
        ? this.getRootFolderUid()
        : (await this.getParentUid(currentUid)) || this.getRootFolderUid(),
      parts[parts.length - 1]
    );

    if (parts.length > 0) {
      const parentUid =
        parts.length > 1
          ? await this.resolveParentPath(path)
          : { uid: this.getRootFolderUid(), type: 'folder' };

      if (parentUid) {
        const node = await this.findNodeByName(parentUid.uid, parts[parts.length - 1]);
        return node;
      }
    }

    return finalNode || { uid: currentUid, type: 'folder' };
  }

  /**
   * Resolve parent path
   */
  private async resolveParentPath(path: string): Promise<{ uid: string; type: string } | null> {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length <= 1) {
      return { uid: this.getRootFolderUid(), type: 'folder' };
    }
    const parentPath = parts.slice(0, -1).join('/');
    return this.resolvePath(parentPath);
  }

  /**
   * Get parent UID (placeholder - would need to track this)
   */
  private async getParentUid(_nodeUid: string): Promise<string | null> {
    // This would require additional tracking or API calls
    return null;
  }

  /**
   * Download a file
   */
  async downloadFile(nodeUid: string): Promise<ReadableStream<Uint8Array>> {
    const client = this.getClient();
    const downloader = await client.getFileDownloader(nodeUid);
    return downloader.downloadToStream();
  }

  /**
   * Upload a file
   */
  async uploadFile(
    parentFolderUid: string,
    name: string,
    content: ReadableStream | Buffer | Uint8Array,
    options: { mimeType?: string; size?: number; modificationTime?: Date } = {}
  ): Promise<string> {
    const client = this.getClient();

    // Check if file exists
    const existing = await this.findNodeByName(parentFolderUid, name);

    const metadata: UploadMetadata = {
      mediaType: options.mimeType || 'application/octet-stream',
      expectedSize: options.size || 0,
      modificationTime: options.modificationTime,
      overrideExistingDraftByOtherClient: true,
    };

    let stream: ReadableStream;
    if (content instanceof ReadableStream) {
      stream = content;
    } else {
      // Convert Buffer/Uint8Array to ReadableStream
      const data = content instanceof Buffer ? new Uint8Array(content) : content;
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
    }

    let uploadController: UploadController;

    if (existing && existing.type === 'file') {
      // Create new revision
      const revisionUploader = await client.getFileRevisionUploader(existing.uid, metadata);
      uploadController = await revisionUploader.uploadFromStream(stream, []);
    } else {
      // Create new file
      const fileUploader = await client.getFileUploader(parentFolderUid, name, metadata);
      uploadController = await fileUploader.uploadFromStream(stream, []);
    }

    const { nodeUid } = await uploadController.completion();
    return nodeUid;
  }

  /**
   * Create a folder
   */
  async createFolder(parentFolderUid: string, name: string): Promise<string> {
    const client = this.getClient();

    // Check if folder exists
    const existing = await this.findNodeByName(parentFolderUid, name);
    if (existing) {
      if (existing.type === 'folder') {
        return existing.uid;
      }
      throw new Error(`A file with name "${name}" already exists`);
    }

    const result = await client.createFolder(parentFolderUid, name);
    if (!result.ok || !result.value) {
      throw new Error(`Failed to create folder: ${result.error}`);
    }

    return result.value.uid;
  }

  /**
   * Delete a node (file or folder)
   */
  async deleteNode(nodeUid: string, permanent = false): Promise<void> {
    const client = this.getClient();

    if (permanent) {
      for await (const result of client.deleteNodes([nodeUid])) {
        if (!result.ok) {
          throw new Error(`Failed to delete: ${result.error}`);
        }
      }
    } else {
      for await (const result of client.trashNodes([nodeUid])) {
        if (!result.ok) {
          throw new Error(`Failed to trash: ${result.error}`);
        }
      }
    }
  }

  /**
   * Rename a node
   */
  async renameNode(nodeUid: string, newName: string): Promise<void> {
    const client = this.getClient();
    const result = await client.renameNode(nodeUid, newName);
    if (!result.ok) {
      throw new Error(`Failed to rename: ${result.error}`);
    }
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(nodeUid: string, newParentUid: string): Promise<void> {
    const client = this.getClient();
    for await (const result of client.moveNodes([nodeUid], newParentUid)) {
      if (!result.ok) {
        throw new Error(`Failed to move: ${result.error}`);
      }
    }
  }
}

// Singleton instance
export const driveClient = new DriveClientManager();

export default DriveClientManager;
