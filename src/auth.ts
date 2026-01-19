/**
 * Proton Drive WebDAV Bridge - Authentication
 *
 * Implements Proton SRP (Secure Remote Password) authentication compatible with
 * the Proton API, including:
 * - SRP authentication with bcrypt password hashing
 * - 2FA/TOTP support
 * - Session persistence (UID, AccessToken, RefreshToken, SaltedKeyPass)
 * - Key decryption using key password derived from bcrypt
 * - SDK integration helpers for creating Drive clients
 *
 * Based on the proton-drive-sync authentication flow.
 */

import bcrypt from 'bcryptjs';
import * as openpgp from 'openpgp';
import {
  deleteStoredCredentials,
  getStoredCredentials,
  storeCredentials,
  type StoredCredentials,
} from './keychain.js';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface AuthInfo {
  Version: number;
  Modulus: string;
  ServerEphemeral: string;
  Salt: string;
  SRPSession?: string;
}

interface Credentials {
  password: string;
}

interface SrpProofs {
  clientEphemeral: Uint8Array;
  clientProof: Uint8Array;
  expectedServerProof: Uint8Array;
  sharedSession: Uint8Array;
}

interface SrpResult {
  clientEphemeral: string;
  clientProof: string;
  expectedServerProof: string;
}

export interface AddressKeyInfo {
  ID: string;
  Primary: number;
  armoredKey: string;
  passphrase: string;
}

/**
 * Password mode for Proton accounts:
 * - 1: Single password mode (login password = mailbox password)
 * - 2: Two-password mode (separate login and mailbox passwords)
 */
export type PasswordMode = 1 | 2;

export interface AddressData {
  ID: string;
  Email: string;
  Type: number;
  Status: number;
  keys: AddressKeyInfo[];
}

export interface Session {
  UID: string;
  AccessToken: string;
  RefreshToken: string;
  UserID?: string;
  Scope?: string;
  user?: User;
  keyPassword?: string;
  primaryKey?: openpgp.PrivateKey;
  addresses?: AddressData[];
  password?: string;
  passwordMode?: PasswordMode;
}

interface User {
  ID: string;
  Name: string;
  Keys?: UserKey[];
}

interface UserKey {
  ID: string;
  PrivateKey: string;
}

interface KeySalt {
  ID: string;
  KeySalt: string;
}

interface Address {
  ID: string;
  Email: string;
  Type: number;
  Status: number;
  Keys?: AddressKeyData[];
}

interface AddressKeyData {
  ID: string;
  Primary: number;
  PrivateKey: string;
  Token?: string;
}

export interface ApiError extends Error {
  code?: number;
  status?: number;
  response?: ApiResponse;
  requires2FA?: boolean;
  twoFAInfo?: TwoFAInfo;
  requiresMailboxPassword?: boolean;
}

interface ApiResponse {
  Code: number;
  Error?: string;
  [key: string]: unknown;
}

interface TwoFAInfo {
  Enabled: number;
  [key: string]: unknown;
}

interface AuthResponse extends ApiResponse {
  UID: string;
  AccessToken: string;
  RefreshToken: string;
  UserID: string;
  Scope: string;
  ServerProof: string;
  PasswordMode?: number;
  '2FA'?: TwoFAInfo;
}

interface ReusableCredentials {
  parentUID: string;
  parentAccessToken: string;
  parentRefreshToken: string;
  childUID: string;
  childAccessToken: string;
  childRefreshToken: string;
  SaltedKeyPass: string;
  UserID: string;
  passwordMode: PasswordMode;
}

interface ForkEncryptedBlob {
  type: 'default';
  keyPassword: string;
}

interface PushForkResponse extends ApiResponse {
  Selector: string;
}

interface PullForkResponse extends ApiResponse {
  UID: string;
  AccessToken: string;
  RefreshToken: string;
  ExpiresIn: number;
  TokenType: string;
  UserID: string;
  Scopes: string[];
  LocalID: number;
  Payload: string;
}

// Error code for invalid/expired refresh token
const INVALID_REFRESH_TOKEN_CODE = 10013;

// ============================================================================
// Constants
// ============================================================================

const API_BASE_URL = 'https://api.protonmail.ch';
const SRP_LEN = 256; // 2048 / 8, in bytes
// AUTH_VERSION = 4 (used by SRP verifier generation, not needed for login flow)
const BCRYPT_PREFIX = '$2y$10$';
const PLATFORM_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows' };
const PLATFORM = PLATFORM_MAP[process.platform] ?? 'macos';
const APP_VERSION =
  PLATFORM === 'windows' ? `${PLATFORM}-drive@1.12.4` : `${PLATFORM}-drive@2.10.1`;
const CHILD_CLIENT_ID = PLATFORM === 'macos' ? 'macOSDrive' : 'windowsDrive';

// Fork payload encryption constants
const FORK_PAYLOAD_IV_LENGTH = 16;
const FORK_PAYLOAD_KEY_LENGTH = 32;
const FORK_PAYLOAD_AAD = 'fork';
const AUTH_REQUIRED_ERROR = 'AUTHENTICATION_REQUIRED';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// SRP Modulus verification key
const SRP_MODULUS_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xjMEXAHLgxYJKwYBBAHaRw8BAQdAFurWXXwjTemqjD7CXjXVyKf0of7n9Ctm
L8v9enkzggHNEnByb3RvbkBzcnAubW9kdWx1c8J3BBAWCgApBQJcAcuDBgsJ
BwgDAgkQNQWFxOlRjyYEFQgKAgMWAgECGQECGwMCHgEAAPGRAP9sauJsW12U
MnTQUZpsbJb53d0Wv55mZIIiJL2XulpWPQD/V6NglBd96lZKBmInSXX/kXat
Sv+y0io+LR8i2+jV+AbOOARcAcuDEgorBgEEAZdVAQUBAQdAeJHUz1c9+KfE
kSIgcBRE3WuXC4oj5a2/U3oASExGDW4DAQgHwmEEGBYIABMFAlwBy4MJEDUF
hcTpUY8mAhsMAAD/XQD8DxNI6E78meodQI+wLsrKLeHn32iLvUqJbVDhfWSU
WO4BAMcm1u02t4VKw++ttECPt+HUgPUq5pqQWe5Q2cW4TMsE
=Y4Mw
-----END PGP PUBLIC KEY BLOCK-----`;

// ============================================================================
// BigInt Utilities
// ============================================================================

function uint8ArrayToBigIntLE(arr: Uint8Array): bigint {
  let result = 0n;
  for (let i = arr.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(arr[arr.length - 1 - i]);
  }
  return result;
}

function bigIntToUint8ArrayLE(num: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let temp = num;
  for (let i = 0; i < length; i++) {
    result[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return result;
}

function bigIntByteLength(num: bigint): number {
  if (num === 0n) return 1;
  let length = 0;
  let temp = num;
  while (temp > 0n) {
    temp >>= 8n;
    length++;
  }
  return length;
}

function modExp(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base = base % modulus;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % modulus;
    }
    exp = exp >> 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function mod(n: bigint, m: bigint): bigint {
  return ((n % m) + m) % m;
}

// ============================================================================
// Crypto Utilities
// ============================================================================

async function sha512(data: Uint8Array): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest('SHA-512', new Uint8Array(data));
  return new Uint8Array(buffer);
}

async function expandHash(input: Uint8Array): Promise<Uint8Array> {
  const hashes = await Promise.all(
    [0, 1, 2, 3].map(async (i) => {
      const combined = new Uint8Array(input.length + 1);
      combined.set(input);
      combined[input.length] = i;
      return sha512(combined);
    })
  );
  const result = new Uint8Array(hashes.reduce((acc, h) => acc + h.length, 0));
  let offset = 0;
  for (const hash of hashes) {
    result.set(hash, offset);
    offset += hash.length;
  }
  return result;
}

function base64Encode(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

function base64Decode(str: string): Uint8Array {
  const binaryStr = atob(str);
  const arr = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    arr[i] = binaryStr.charCodeAt(i);
  }
  return arr;
}

function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function binaryStringToArray(str: string): Uint8Array {
  const result = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    result[i] = str.charCodeAt(i);
  }
  return result;
}

function uint8ArrayToBinaryString(arr: Uint8Array): string {
  return String.fromCharCode(...arr);
}

function mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ============================================================================
// AES-GCM Encryption for Session Forking
// ============================================================================

async function importAesGcmKey(rawKey: Uint8Array): Promise<CryptoKey> {
  const keyBuffer = new Uint8Array(rawKey).buffer as ArrayBuffer;
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptForkPayload(
  key: CryptoKey,
  data: string,
  additionalData?: Uint8Array
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(FORK_PAYLOAD_IV_LENGTH));
  const encodedData = stringToUint8Array(data);
  const ivBuffer = new Uint8Array(iv);
  const dataBuffer = new Uint8Array(encodedData);
  const aadBuffer = additionalData ? new Uint8Array(additionalData) : undefined;

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer,
      ...(aadBuffer !== undefined ? { additionalData: aadBuffer } : {}),
    },
    key,
    dataBuffer
  );

  const result = mergeUint8Arrays([iv, new Uint8Array(ciphertext)]);
  return base64Encode(result);
}

async function decryptForkPayload(
  key: CryptoKey,
  blob: string,
  additionalData?: Uint8Array
): Promise<string> {
  const data = base64Decode(blob);
  const iv = data.slice(0, FORK_PAYLOAD_IV_LENGTH);
  const ciphertext = data.slice(FORK_PAYLOAD_IV_LENGTH);
  const ivBuffer = new Uint8Array(iv);
  const ciphertextBuffer = new Uint8Array(ciphertext);
  const aadBuffer = additionalData ? new Uint8Array(additionalData) : undefined;

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer,
      ...(aadBuffer !== undefined ? { additionalData: aadBuffer } : {}),
    },
    key,
    ciphertextBuffer
  );

  return new TextDecoder().decode(decrypted);
}

async function createForkEncryptedBlob(
  keyPassword: string
): Promise<{ key: Uint8Array; blob: string }> {
  const rawKey = crypto.getRandomValues(new Uint8Array(FORK_PAYLOAD_KEY_LENGTH));
  const cryptoKey = await importAesGcmKey(rawKey);
  const payload: ForkEncryptedBlob = { type: 'default', keyPassword };
  const aad = stringToUint8Array(FORK_PAYLOAD_AAD);
  const blob = await encryptForkPayload(cryptoKey, JSON.stringify(payload), aad);
  return { key: rawKey, blob };
}

async function decryptForkEncryptedBlob(key: Uint8Array, blob: string): Promise<string> {
  const cryptoKey = await importAesGcmKey(key);
  const aad = stringToUint8Array(FORK_PAYLOAD_AAD);
  const decrypted = await decryptForkPayload(cryptoKey, blob, aad);
  const payload: ForkEncryptedBlob = JSON.parse(decrypted);
  return payload.keyPassword;
}

// ============================================================================
// bcrypt Utilities
// ============================================================================

function bcryptEncodeBase64(data: Uint8Array, length: number): string {
  const BCRYPT_CHARS = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  let off = 0;
  let c1: number, c2: number;

  while (off < length) {
    c1 = data[off++] & 0xff;
    result += BCRYPT_CHARS[(c1 >> 2) & 0x3f];
    c1 = (c1 & 0x03) << 4;
    if (off >= length) {
      result += BCRYPT_CHARS[c1 & 0x3f];
      break;
    }
    c2 = data[off++] & 0xff;
    c1 |= (c2 >> 4) & 0x0f;
    result += BCRYPT_CHARS[c1 & 0x3f];
    c1 = (c2 & 0x0f) << 2;
    if (off >= length) {
      result += BCRYPT_CHARS[c1 & 0x3f];
      break;
    }
    c2 = data[off++] & 0xff;
    c1 |= (c2 >> 6) & 0x03;
    result += BCRYPT_CHARS[c1 & 0x3f];
    result += BCRYPT_CHARS[c2 & 0x3f];
  }
  return result;
}

// ============================================================================
// Password Hashing
// ============================================================================

interface HashPasswordParams {
  password: string;
  salt?: string;
  modulus: Uint8Array;
  version: number;
}

async function formatHash(
  password: string,
  salt: string,
  modulus: Uint8Array
): Promise<Uint8Array> {
  const hash = bcrypt.hashSync(password, BCRYPT_PREFIX + salt);
  const hashBytes = stringToUint8Array(hash);
  return expandHash(mergeUint8Arrays([hashBytes, modulus]));
}

async function hashPasswordV3(
  password: string,
  salt: string,
  modulus: Uint8Array
): Promise<Uint8Array> {
  const saltBinary = binaryStringToArray(salt + 'proton');
  const bcryptSalt = bcryptEncodeBase64(saltBinary, 16);
  return formatHash(password, bcryptSalt, modulus);
}

async function hashPassword({
  password,
  salt,
  modulus,
  version,
}: HashPasswordParams): Promise<Uint8Array> {
  if (version >= 3) {
    if (!salt) throw new Error('Missing salt for auth version >= 3');
    return hashPasswordV3(password, salt, modulus);
  }
  throw new Error(`Unsupported auth version: ${version}`);
}

async function computeKeyPassword(password: string, salt: string): Promise<string> {
  if (!password || !salt || salt.length !== 24 || password.length < 1) {
    throw new Error('Password and salt required.');
  }
  const saltBinary = base64Decode(salt);
  const bcryptSalt = bcryptEncodeBase64(saltBinary, 16);
  const hash = bcrypt.hashSync(password, BCRYPT_PREFIX + bcryptSalt);
  return hash.slice(29);
}

// ============================================================================
// SRP Protocol
// ============================================================================

interface GenerateProofsParams {
  byteLength: number;
  modulusArray: Uint8Array;
  hashedPasswordArray: Uint8Array;
  serverEphemeralArray: Uint8Array;
}

async function verifyAndGetModulus(signedModulus: string): Promise<Uint8Array> {
  const publicKey = await openpgp.readKey({ armoredKey: SRP_MODULUS_KEY });
  const message = await openpgp.readCleartextMessage({ cleartextMessage: signedModulus });
  const verificationResult = await openpgp.verify({
    message,
    verificationKeys: publicKey,
  });

  const { verified } = verificationResult.signatures[0];
  try {
    await verified;
  } catch (error) {
    logger.warn(`Server identity verification failed: ${error}`);
    throw new Error('Unable to verify server identity');
  }

  const modulusData = verificationResult.data;
  return base64Decode(modulusData);
}

async function generateProofs({
  byteLength,
  modulusArray,
  hashedPasswordArray,
  serverEphemeralArray,
}: GenerateProofsParams): Promise<SrpProofs> {
  const modulus = uint8ArrayToBigIntLE(modulusArray.slice().reverse());

  if (bigIntByteLength(modulus) !== byteLength) {
    throw new Error('SRP modulus has incorrect size');
  }

  const generator = 2n;
  const generatorArray = bigIntToUint8ArrayLE(generator, byteLength);
  const multiplierHash = await expandHash(mergeUint8Arrays([generatorArray, modulusArray]));
  const multiplier = uint8ArrayToBigIntLE(multiplierHash.slice().reverse());

  const serverEphemeral = uint8ArrayToBigIntLE(serverEphemeralArray.slice().reverse());
  const hashedPassword = uint8ArrayToBigIntLE(hashedPasswordArray.slice().reverse());

  if (serverEphemeral === 0n) {
    throw new Error('SRP server ephemeral is out of bounds');
  }

  const modulusMinusOne = modulus - 1n;
  const multiplierReduced = mod(multiplier, modulus);

  let clientSecret: bigint = 0n;
  let clientEphemeral: bigint = 0n;
  let scramblingParam: bigint = 0n;

  for (let i = 0; i < 1000; i++) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(byteLength));
    clientSecret = uint8ArrayToBigIntLE(randomBytes.slice().reverse());
    clientEphemeral = modExp(generator, clientSecret, modulus);

    const clientEphemeralArray = bigIntToUint8ArrayLE(clientEphemeral, byteLength);
    const clientServerHash = await expandHash(
      mergeUint8Arrays([clientEphemeralArray, serverEphemeralArray])
    );
    scramblingParam = uint8ArrayToBigIntLE(clientServerHash.slice().reverse());

    if (scramblingParam !== 0n && clientEphemeral !== 0n) {
      break;
    }
  }

  const kgx = mod(modExp(generator, hashedPassword, modulus) * multiplierReduced, modulus);
  const sharedSessionKeyExponent = mod(
    scramblingParam * hashedPassword + clientSecret,
    modulusMinusOne
  );
  const sharedSessionKeyBase = mod(serverEphemeral - kgx, modulus);
  const sharedSessionKey = modExp(sharedSessionKeyBase, sharedSessionKeyExponent, modulus);

  const clientEphemeralArray = bigIntToUint8ArrayLE(clientEphemeral, byteLength);
  const sharedSessionArray = bigIntToUint8ArrayLE(sharedSessionKey, byteLength);

  const clientProof = await expandHash(
    mergeUint8Arrays([clientEphemeralArray, serverEphemeralArray, sharedSessionArray])
  );
  const expectedServerProof = await expandHash(
    mergeUint8Arrays([clientEphemeralArray, clientProof, sharedSessionArray])
  );

  return {
    clientEphemeral: clientEphemeralArray,
    clientProof,
    expectedServerProof,
    sharedSession: sharedSessionArray,
  };
}

async function getSrp(authInfo: AuthInfo, credentials: Credentials): Promise<SrpResult> {
  const { Version, Modulus: serverModulus, ServerEphemeral, Salt } = authInfo;
  const { password } = credentials;

  const modulusArray = await verifyAndGetModulus(serverModulus);
  const serverEphemeralArray = base64Decode(ServerEphemeral);

  const hashedPasswordArray = await hashPassword({
    version: Version,
    password,
    salt: Version >= 3 ? uint8ArrayToBinaryString(base64Decode(Salt)) : undefined,
    modulus: modulusArray,
  });

  const { clientEphemeral, clientProof, expectedServerProof } = await generateProofs({
    byteLength: SRP_LEN,
    modulusArray,
    hashedPasswordArray,
    serverEphemeralArray,
  });

  return {
    clientEphemeral: base64Encode(clientEphemeral),
    clientProof: base64Encode(clientProof),
    expectedServerProof: base64Encode(expectedServerProof),
  };
}

// ============================================================================
// HTTP Client
// ============================================================================

function createHeaders(session: Session | null = null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-pm-appversion': APP_VERSION,
  };
  if (session?.UID) {
    headers['x-pm-uid'] = session.UID;
  }
  if (session?.AccessToken) {
    headers['Authorization'] = `Bearer ${session.AccessToken}`;
  }
  return headers;
}

async function apiRequest<T extends ApiResponse>(
  method: string,
  endpoint: string,
  data: Record<string, unknown> | null = null,
  session: Session | null = null
): Promise<T> {
  const url = `${API_BASE_URL}/${endpoint}`;
  const options: RequestInit = {
    method,
    headers: createHeaders(session),
  };
  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  const json = (await response.json()) as T;

  if (!response.ok || json.Code !== 1000) {
    const error = new Error(json.Error || `API error: ${response.status}`) as ApiError;
    error.code = json.Code;
    error.response = json;
    error.status = response.status;
    throw error;
  }

  return json;
}

export type ApiRequester = <T extends ApiResponse>(
  method: string,
  endpoint: string,
  data?: Record<string, unknown> | null,
  session?: Session | null
) => Promise<T>;

export const defaultApiRequester: ApiRequester = apiRequest;

// ============================================================================
// ProtonAuth Class
// ============================================================================

export class ProtonAuth {
  private session: Session | null = null;
  private parentSession: Session | null = null;

  constructor(private apiRequest: ApiRequester = defaultApiRequester) {}

  private async apiRequestWithRefresh<T extends ApiResponse>(
    method: string,
    endpoint: string,
    data: Record<string, unknown> | null = null
  ): Promise<T> {
    if (!this.session) {
      throw new Error('No session available');
    }

    try {
      return await this.apiRequest<T>(method, endpoint, data, this.session);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 401 && this.session?.RefreshToken) {
        logger.info('Access token expired, attempting refresh...');
        await this.refreshToken();
        return await this.apiRequest<T>(method, endpoint, data, this.session);
      }
      throw error;
    }
  }

  async login(
    username: string,
    password: string,
    twoFactorCode: string | null = null
  ): Promise<Session> {
    // Get auth info
    const authInfo = await this.apiRequest<AuthInfo & ApiResponse>('POST', 'core/v4/auth/info', {
      Username: username,
    });

    // Generate SRP proofs
    const { clientEphemeral, clientProof, expectedServerProof } = await getSrp(authInfo, {
      password,
    });

    // Authenticate
    const authData: Record<string, unknown> = {
      Username: username,
      ClientEphemeral: clientEphemeral,
      ClientProof: clientProof,
      SRPSession: authInfo.SRPSession,
      PersistentCookies: 0,
    };

    if (twoFactorCode) {
      authData.TwoFactorCode = twoFactorCode;
    }

    const authResponse = await this.apiRequest<AuthResponse>('POST', 'core/v4/auth', authData);

    // Verify server proof
    if (authResponse.ServerProof !== expectedServerProof) {
      throw new Error('Server proof verification failed');
    }

    // Check if 2FA is required
    if (authResponse['2FA']?.Enabled && !twoFactorCode) {
      // Store pending auth response in session for later retrieval
      this.session = {
        UID: authResponse.UID,
        AccessToken: authResponse.AccessToken,
        RefreshToken: authResponse.RefreshToken,
        passwordMode: (authResponse.PasswordMode ?? 1) as PasswordMode,
      };

      const error = new Error('2FA required') as ApiError;
      error.requires2FA = true;
      error.twoFAInfo = authResponse['2FA'];
      this.session.password = password;
      throw error;
    }

    // Check for two-password mode
    const passwordMode = (authResponse.PasswordMode ?? 1) as PasswordMode;
    if (passwordMode === 2) {
      this.parentSession = {
        UID: authResponse.UID,
        AccessToken: authResponse.AccessToken,
        RefreshToken: authResponse.RefreshToken,
        UserID: authResponse.UserID,
        Scope: authResponse.Scope,
        passwordMode: 2,
      };
      this.session = { ...this.parentSession };

      const error = new Error('Mailbox password required') as ApiError;
      error.requiresMailboxPassword = true;
      throw error;
    }

    // Store as parent session first
    this.parentSession = {
      UID: authResponse.UID,
      AccessToken: authResponse.AccessToken,
      RefreshToken: authResponse.RefreshToken,
      UserID: authResponse.UserID,
      Scope: authResponse.Scope,
      passwordMode: 1,
    };

    this.session = this.parentSession;
    await this._fetchUserAndKeys(password);

    this.parentSession.keyPassword = this.session.keyPassword;
    this.parentSession.user = this.session.user;
    this.parentSession.primaryKey = this.session.primaryKey;
    this.parentSession.addresses = this.session.addresses;

    logger.info('Forking child session from parent...');
    await this.forkNewChildSession();

    return this.session;
  }

  async submit2FA(code: string): Promise<Session> {
    if (!this.session?.UID) {
      throw new Error('No pending 2FA authentication');
    }

    const response = await this.apiRequest<
      ApiResponse & { AccessToken?: string; RefreshToken?: string }
    >('POST', 'core/v4/auth/2fa', { TwoFactorCode: code }, this.session);

    if (response.AccessToken) {
      this.session.AccessToken = response.AccessToken;
    }
    if (response.RefreshToken) {
      this.session.RefreshToken = response.RefreshToken;
    }

    this.parentSession = {
      UID: this.session.UID,
      AccessToken: this.session.AccessToken,
      RefreshToken: this.session.RefreshToken,
      UserID: this.session.UserID,
      Scope: this.session.Scope,
      passwordMode: this.session.passwordMode,
    };

    if (this.session.passwordMode === 2) {
      const error = new Error('Mailbox password required') as ApiError;
      error.requiresMailboxPassword = true;
      throw error;
    }

    if (this.session.password) {
      await this._fetchUserAndKeys(this.session.password);

      this.parentSession.keyPassword = this.session.keyPassword;
      this.parentSession.user = this.session.user;
      this.parentSession.primaryKey = this.session.primaryKey;
      this.parentSession.addresses = this.session.addresses;

      logger.info('Forking child session from parent...');
      await this.forkNewChildSession();
    }

    return this.session;
  }

  async submitMailboxPassword(mailboxPassword: string): Promise<Session> {
    if (!this.session?.UID) {
      throw new Error('No pending authentication - call login() first');
    }
    if (this.session.passwordMode !== 2) {
      throw new Error('Mailbox password not required for this account');
    }

    await this._fetchUserAndKeys(mailboxPassword);

    if (!this.parentSession || !this.session) {
      throw new Error('No parent session available - call login() first');
    }
    this.parentSession.keyPassword = this.session.keyPassword;
    this.parentSession.user = this.session.user;
    this.parentSession.primaryKey = this.session.primaryKey;
    this.parentSession.addresses = this.session.addresses;

    logger.info('Forking child session from parent...');
    await this.forkNewChildSession();

    return this.session;
  }

  private async _processAddressKeys(
    addresses: Address[],
    keySalts: KeySalt[],
    keyPassword: string,
    password?: string,
    passwordMode: number = 1
  ): Promise<AddressData[]> {
    const result: AddressData[] = [];

    for (const address of addresses) {
      const addressData: AddressData = {
        ID: address.ID,
        Email: address.Email,
        Type: address.Type,
        Status: address.Status,
        keys: [],
      };

      for (const key of address.Keys || []) {
        try {
          let addressKeyPassword: string | undefined;

          if (key.Token && this.session?.primaryKey) {
            const decryptedToken = await openpgp.decrypt({
              message: await openpgp.readMessage({ armoredMessage: key.Token }),
              decryptionKeys: this.session.primaryKey,
            });
            addressKeyPassword = decryptedToken.data as string;
          } else if (key.Token && passwordMode === 2) {
            throw new Error(`Address key ${key.ID} has Token but primary key is not available.`);
          } else if (password) {
            const keySalt = keySalts.find((s) => s.ID === key.ID);
            if (keySalt?.KeySalt) {
              addressKeyPassword = await computeKeyPassword(password, keySalt.KeySalt);
            }
          }

          if (!addressKeyPassword) {
            if (passwordMode === 2) {
              throw new Error(`Failed to derive passphrase for address key ${key.ID}`);
            }
            addressKeyPassword = keyPassword;
          }

          if (addressKeyPassword && passwordMode === 2) {
            try {
              const privateKey = await openpgp.readPrivateKey({ armoredKey: key.PrivateKey });
              await openpgp.decryptKey({ privateKey, passphrase: addressKeyPassword });
            } catch (error) {
              logger.warn(`Failed to verify address key ${key.ID} passphrase: ${error}`);
              throw new Error(`Address key ${key.ID} passphrase verification failed.`);
            }
          }

          if (addressKeyPassword) {
            addressData.keys.push({
              ID: key.ID,
              Primary: key.Primary,
              armoredKey: key.PrivateKey,
              passphrase: addressKeyPassword,
            });
          }
        } catch (error) {
          if (passwordMode === 2) {
            throw new Error(`Failed to process address key ${key.ID}: ${(error as Error).message}`);
          }
          logger.warn(`Failed to process address key ${key.ID}:`, (error as Error).message);
        }
      }

      result.push(addressData);
    }

    return result;
  }

  private async _fetchUserAndKeys(password: string): Promise<void> {
    if (!this.session) {
      throw new Error('No session available');
    }

    const userResponse = await this.apiRequest<ApiResponse & { User: User }>(
      'GET',
      'core/v4/users',
      null,
      this.session
    );
    this.session.user = userResponse.User;

    const saltsResponse = await this.apiRequest<ApiResponse & { KeySalts?: KeySalt[] }>(
      'GET',
      'core/v4/keys/salts',
      null,
      this.session
    );
    const keySalts = saltsResponse.KeySalts || [];

    const addressesResponse = await this.apiRequest<ApiResponse & { Addresses?: Address[] }>(
      'GET',
      'core/v4/addresses',
      null,
      this.session
    );
    const addresses = addressesResponse.Addresses || [];

    const primaryKey = this.session.user?.Keys?.[0];
    if (primaryKey) {
      const keySalt = keySalts.find((s) => s.ID === primaryKey.ID);

      if (keySalt?.KeySalt) {
        const keyPassword = await computeKeyPassword(password, keySalt.KeySalt);
        this.session.keyPassword = keyPassword;

        try {
          const privateKey = await openpgp.readPrivateKey({
            armoredKey: primaryKey.PrivateKey,
          });
          const decryptedKey = await openpgp.decryptKey({
            privateKey,
            passphrase: keyPassword,
          });
          this.session.primaryKey = decryptedKey;
        } catch (error) {
          logger.warn('Failed to decrypt primary key:', (error as Error).message);
        }
      }
    }

    this.session.addresses = await this._processAddressKeys(
      addresses,
      keySalts,
      this.session.keyPassword || '',
      password,
      this.session.passwordMode ?? 1
    );
  }

  getSession(): Session | null {
    return this.session;
  }

  getReusableCredentials(): ReusableCredentials {
    if (!this.session || !this.parentSession) {
      throw new Error('Not authenticated');
    }
    if (!this.session.keyPassword) {
      throw new Error('No key password available');
    }
    if (!this.session.UserID) {
      throw new Error('No user ID available');
    }
    return {
      parentUID: this.parentSession.UID,
      parentAccessToken: this.parentSession.AccessToken,
      parentRefreshToken: this.parentSession.RefreshToken,
      childUID: this.session.UID,
      childAccessToken: this.session.AccessToken,
      childRefreshToken: this.session.RefreshToken,
      SaltedKeyPass: this.session.keyPassword,
      UserID: this.session.UserID,
      passwordMode: this.session.passwordMode ?? 1,
    };
  }

  async restoreSession(credentials: ReusableCredentials): Promise<Session> {
    const {
      parentUID,
      parentAccessToken,
      parentRefreshToken,
      childUID,
      childAccessToken,
      childRefreshToken,
      SaltedKeyPass,
      UserID,
    } = credentials;

    this.parentSession = {
      UID: parentUID,
      AccessToken: parentAccessToken,
      RefreshToken: parentRefreshToken,
      keyPassword: SaltedKeyPass,
      passwordMode: credentials.passwordMode,
      UserID,
    };

    this.session = {
      UID: childUID,
      AccessToken: childAccessToken,
      RefreshToken: childRefreshToken,
      keyPassword: SaltedKeyPass,
      passwordMode: credentials.passwordMode,
      UserID,
    };

    try {
      // Verify the session is still valid by fetching user info
      // If tokens are expired, apiRequestWithRefresh will handle token refresh automatically
      const userResponse = await this.apiRequestWithRefresh<ApiResponse & { User: User }>(
        'GET',
        'core/v4/users'
      );
      this.session.user = userResponse.User;

      const primaryUserKey = this.session.user?.Keys?.[0];
      if (primaryUserKey && SaltedKeyPass) {
        try {
          const privateKey = await openpgp.readPrivateKey({
            armoredKey: primaryUserKey.PrivateKey,
          });
          const decryptedKey = await openpgp.decryptKey({
            privateKey,
            passphrase: SaltedKeyPass,
          });
          this.session.primaryKey = decryptedKey;
        } catch (error) {
          if (credentials.passwordMode === 2) {
            throw new Error(`Failed to decrypt primary user key in two-password mode.`);
          }
          logger.warn('Failed to decrypt primary user key:', (error as Error).message);
        }
      }

      const addressesResponse = await this.apiRequestWithRefresh<
        ApiResponse & { Addresses?: Address[] }
      >('GET', 'core/v4/addresses');
      const addresses = addressesResponse.Addresses || [];

      this.session.addresses = await this._processAddressKeys(
        addresses,
        [],
        SaltedKeyPass,
        undefined,
        credentials.passwordMode
      );

      return this.session;
    } catch (error) {
      this.session = null;
      throw new Error(`Failed to restore session: ${(error as Error).message}`);
    }
  }

  private async _refreshSessionTokens(
    uid: string,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let attempts = 3;
    while (attempts > 0) {
      attempts -= 1;
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pm-appversion': APP_VERSION,
          'x-pm-uid': uid,
        },
        body: JSON.stringify({
          ResponseType: 'token',
          GrantType: 'refresh_token',
          RefreshToken: refreshToken,
          RedirectURI: 'https://protonmail.com',
        }),
      });

      const json = (await response.json()) as ApiResponse & {
        AccessToken?: string;
        RefreshToken?: string;
      };

      if (response.ok && json.Code === 1000) {
        if (!json.AccessToken || !json.RefreshToken) {
          throw new Error('Token refresh response missing tokens');
        }
        return { accessToken: json.AccessToken, refreshToken: json.RefreshToken };
      }

      if (response.status === 409) {
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        await sleep(500 * (4 - attempts));
        continue;
      }

      if (
        response.status === 400 ||
        response.status === 422 ||
        json.Code === INVALID_REFRESH_TOKEN_CODE
      ) {
        throw new Error(AUTH_REQUIRED_ERROR);
      }

      throw new Error(json.Error || 'Token refresh failed');
    }

    throw new Error('Token refresh failed');
  }

  private isInvalidRefreshTokenError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('INVALID_REFRESH_TOKEN');
    }
    return false;
  }

  private isAuthRequiredError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes(AUTH_REQUIRED_ERROR);
    }
    return false;
  }

  private clearSessionData(): void {
    this.session = null;
    this.parentSession = null;
  }

  async refreshToken(): Promise<Session> {
    if (!this.session?.RefreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const tokens = await this._refreshSessionTokens(this.session.UID, this.session.RefreshToken);
      this.session.AccessToken = tokens.accessToken;
      this.session.RefreshToken = tokens.refreshToken;
      return this.session;
    } catch (error) {
      if (this.isAuthRequiredError(error) || this.isInvalidRefreshTokenError(error)) {
        this.clearSessionData();
        throw new Error('Authentication required');
      }
      throw error;
    }
  }

  private async pushForkSession(
    parentSession: Session
  ): Promise<{ selector: string; encryptionKey: Uint8Array }> {
    if (!parentSession.keyPassword) {
      throw new Error('No keyPassword available for fork encryption');
    }

    const { key: encryptionKey, blob } = await createForkEncryptedBlob(parentSession.keyPassword);

    const response = await fetch(`${API_BASE_URL}/auth/v4/sessions/forks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pm-appversion': APP_VERSION,
        'x-pm-uid': parentSession.UID,
        Authorization: `Bearer ${parentSession.AccessToken}`,
      },
      body: JSON.stringify({
        ChildClientID: CHILD_CLIENT_ID,
        Independent: 1,
        Payload: blob,
      }),
    });

    const json = (await response.json()) as ApiResponse & PushForkResponse;

    if (!response.ok || json.Code !== 1000) {
      throw new Error(json.Error || 'Failed to push fork session');
    }

    if (!json.Selector) {
      throw new Error('Fork response missing Selector');
    }

    return { selector: json.Selector, encryptionKey };
  }

  private async pullForkSession(
    selector: string,
    encryptionKey: Uint8Array,
    parentSession: Session
  ): Promise<{
    UID: string;
    AccessToken: string;
    RefreshToken: string;
    UserID: string;
    keyPassword: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/auth/v4/sessions/forks/${selector}`, {
      method: 'GET',
      headers: {
        'x-pm-appversion': APP_VERSION,
        'x-pm-uid': parentSession.UID,
        Authorization: `Bearer ${parentSession.AccessToken}`,
      },
    });

    const json = (await response.json()) as ApiResponse & PullForkResponse;

    if (!response.ok || json.Code !== 1000) {
      throw new Error(json.Error || 'Failed to pull fork session');
    }

    if (!json.UID || !json.AccessToken || !json.RefreshToken) {
      throw new Error('Fork response missing required session data');
    }

    let keyPassword: string;
    if (json.Payload) {
      keyPassword = await decryptForkEncryptedBlob(encryptionKey, json.Payload);
    } else {
      if (!parentSession.keyPassword) {
        throw new Error('No keyPassword available from fork or parent');
      }
      keyPassword = parentSession.keyPassword;
    }

    return {
      UID: json.UID,
      AccessToken: json.AccessToken,
      RefreshToken: json.RefreshToken,
      UserID: json.UserID,
      keyPassword,
    };
  }

  async forkNewChildSession(): Promise<Session> {
    if (!this.parentSession) {
      throw new Error('No parent session available - re-authentication required');
    }

    logger.info('Forking new child session from parent session');

    try {
      try {
        const tokens = await this._refreshSessionTokens(
          this.parentSession.UID,
          this.parentSession.RefreshToken
        );
        this.parentSession.AccessToken = tokens.accessToken;
        this.parentSession.RefreshToken = tokens.refreshToken;
      } catch (error) {
        if (this.isInvalidRefreshTokenError(error)) {
          throw new Error('Parent session expired - re-authentication required');
        }
        throw error;
      }

      const { selector, encryptionKey } = await this.pushForkSession(this.parentSession);
      const childSession = await this.pullForkSession(selector, encryptionKey, this.parentSession);

      if (!this.session) {
        this.session = { ...this.parentSession };
      }

      this.session.UID = childSession.UID;
      this.session.AccessToken = childSession.AccessToken;
      this.session.RefreshToken = childSession.RefreshToken;
      this.session.keyPassword = childSession.keyPassword;
      this.session.UserID = childSession.UserID;

      logger.info('Successfully forked new child session');

      return this.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fork child session: ${message}`);

      if (message.includes('Parent session expired') || message.includes('INVALID_REFRESH_TOKEN')) {
        this.parentSession = null;
      }

      throw error;
    }
  }

  async logout(): Promise<void> {
    if (!this.session?.UID) {
      return;
    }

    try {
      await fetch(`${API_BASE_URL}/core/v4/auth`, {
        method: 'DELETE',
        headers: createHeaders(this.session),
      });
    } catch (error) {
      // Log but don't throw - logout failure is non-critical
      logger.debug(`Logout request failed: ${error}`);
    }

    this.session = null;
  }
}

// ============================================================================
// Credential Storage Integration
// ============================================================================

/**
 * Authenticate and store credentials
 */
export async function authenticateAndStore(
  username: string,
  password: string,
  twoFactorCode?: string,
  mailboxPassword?: string
): Promise<Session> {
  const auth = new ProtonAuth();

  try {
    await auth.login(username, password, twoFactorCode || null);
  } catch (error) {
    const apiError = error as ApiError;

    if (apiError.requires2FA && twoFactorCode) {
      await auth.submit2FA(twoFactorCode);
    } else if (apiError.requires2FA) {
      throw error;
    }

    if (apiError.requiresMailboxPassword && mailboxPassword) {
      await auth.submitMailboxPassword(mailboxPassword);
    } else if (apiError.requiresMailboxPassword) {
      throw error;
    }
  }

  const credentials = auth.getReusableCredentials();
  const storedCreds: StoredCredentials = {
    ...credentials,
    username,
  };

  await storeCredentials(storedCreds);
  logger.info(`Credentials stored for ${username}`);

  const session = auth.getSession();
  if (!session) {
    throw new Error('Failed to complete authentication');
  }
  return session;
}

/**
 * Restore session from stored credentials
 */
export async function restoreSessionFromStorage(): Promise<{
  auth: ProtonAuth;
  session: Session;
  username: string;
}> {
  const storedCreds = await getStoredCredentials();
  if (!storedCreds) {
    throw new Error('No stored credentials found');
  }

  const auth = new ProtonAuth();
  let session: Session;
  try {
    session = await auth.restoreSession(storedCreds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Authentication required') ||
      message.includes('Parent session expired') ||
      message.includes('INVALID_REFRESH_TOKEN')
    ) {
      await deleteStoredCredentials();
    }
    throw error;
  }

  // Update stored credentials with refreshed tokens
  const newCreds = auth.getReusableCredentials();
  const updatedCreds: StoredCredentials = {
    ...newCreds,
    username: storedCreds.username,
  };
  await storeCredentials(updatedCreds);

  return { auth, session, username: storedCreds.username };
}

export default ProtonAuth;
