/**
 * Proton Drive WebDAV Bridge - Secure Keychain
 *
 * Cross-platform secure credential storage:
 * - macOS: Keychain via @napi-rs/keyring
 * - Windows: Credential Manager via @napi-rs/keyring
 * - Linux desktop: libsecret via @napi-rs/keyring
 * - Linux headless: AES-256-GCM encrypted file with KEYRING_PASSWORD env var
 *
 * Security Features:
 * - Native OS credential storage where available
 * - AES-256-GCM encryption for file-based fallback
 * - PBKDF2 key derivation from password
 * - Secure file permissions (0600)
 */

import { Entry } from '@napi-rs/keyring';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto';
import { logger } from './logger.js';
import { getCredentialsFilePath } from './paths.js';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_NAME = 'proton-drive-webdav-bridge';
const ACCOUNT_NAME = 'proton-drive-webdav-bridge:credentials';
const DEFAULT_KEYRING_PASSWORD = 'proton-drive-webdav-bridge-default';

// Encryption constants
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256
const PBKDF2_ITERATIONS = 100000;
const AUTH_TAG_LENGTH = 16;

// ============================================================================
// Types
// ============================================================================

export interface StoredCredentials {
  // Parent session (from initial login, used to fork new child sessions)
  parentUID: string;
  parentAccessToken: string;
  parentRefreshToken: string;

  // Child session (used for API operations, can be refreshed via forking)
  childUID: string;
  childAccessToken: string;
  childRefreshToken: string;

  // Shared credentials
  SaltedKeyPass: string;
  UserID: string;
  username: string;

  // Password mode: 1 = Single, 2 = Two-password mode
  passwordMode: PasswordMode;
}

export type PasswordMode = 1 | 2;

// ============================================================================
// Storage Strategy Detection
// ============================================================================

/**
 * Determine the appropriate storage strategy.
 * On Linux headless (no display), use file-based storage.
 * Otherwise, try native keyring.
 */
function shouldUseFileStorage(): boolean {
  // If KEYRING_PASSWORD is set, user explicitly wants file storage
  if (process.env.KEYRING_PASSWORD) {
    return true;
  }

  // On Linux without display server, use file storage
  if (process.platform === 'linux') {
    const hasDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
    if (!hasDisplay) {
      logger.debug('No display detected on Linux, using file-based storage');
      return true;
    }
  }

  return false;
}

/**
 * Get the keyring password for file-based storage.
 * Uses KEYRING_PASSWORD env var if set, otherwise falls back to default.
 */
function getKeyringPassword(): string {
  const password = process.env.KEYRING_PASSWORD;
  if (!password) {
    logger.warn(
      'KEYRING_PASSWORD not set, using default (less secure). Set KEYRING_PASSWORD for production.'
    );
    return DEFAULT_KEYRING_PASSWORD;
  }
  return password;
}

// ============================================================================
// File-Based Encrypted Storage
// ============================================================================

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt data using AES-256-GCM
 */
function encryptData(data: string, password: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: [salt][iv][authTag][encrypted]
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypt data using AES-256-GCM
 */
function decryptData(encryptedBuffer: Buffer, password: string): string {
  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const encrypted = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Store credentials to encrypted file
 */
function storeCredentialsToFile(credentials: StoredCredentials, password: string): void {
  const filePath = getCredentialsFilePath();
  const jsonData = JSON.stringify(credentials);
  const encrypted = encryptData(jsonData, password);

  // Write with secure permissions (0600 = owner read/write only)
  writeFileSync(filePath, encrypted, { mode: 0o600 });
  logger.debug(`Stored credentials to encrypted file: ${filePath}`);
}

/**
 * Get credentials from encrypted file
 */
function getCredentialsFromFile(password: string): StoredCredentials | null {
  const filePath = getCredentialsFilePath();

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const encrypted = readFileSync(filePath);
    const jsonData = decryptData(encrypted, password);
    return JSON.parse(jsonData) as StoredCredentials;
  } catch (error) {
    logger.error(`Failed to decrypt credentials file: ${error}`);
    return null;
  }
}

/**
 * Delete credentials file
 */
function deleteCredentialsFile(): void {
  const filePath = getCredentialsFilePath();
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    logger.debug(`Deleted credentials file: ${filePath}`);
  }
}

// ============================================================================
// Native Keyring Storage
// ============================================================================

/**
 * Store credentials using native keyring
 */
async function storeCredentialsToKeyring(credentials: StoredCredentials): Promise<void> {
  const entry = new Entry(SERVICE_NAME, ACCOUNT_NAME);
  const jsonData = JSON.stringify(credentials);
  try {
    entry.setPassword(jsonData);
    logger.info(
      `Stored credentials to native keyring (service: ${SERVICE_NAME}, account: ${ACCOUNT_NAME})`
    );
  } catch (error) {
    logger.error(`Failed to store credentials to keyring: ${error}`);
    throw error;
  }
}

/**
 * Get credentials from native keyring
 */
function getCredentialsFromKeyring(): StoredCredentials | null {
  try {
    const entry = new Entry(SERVICE_NAME, ACCOUNT_NAME);
    const password = entry.getPassword();
    if (!password) {
      logger.debug('No credentials found in keyring');
      return null;
    }
    const creds = JSON.parse(password) as StoredCredentials;
    logger.info(
      `Loaded credentials from keyring (parentUID: ${creds.parentUID}, childUID: ${creds.childUID})`
    );
    return creds;
  } catch (error) {
    // Entry not found or access denied
    logger.debug(`Failed to get credentials from keyring: ${error}`);
    return null;
  }
}

/**
 * Delete credentials from native keyring
 */
function deleteCredentialsFromKeyring(): void {
  try {
    const entry = new Entry(SERVICE_NAME, ACCOUNT_NAME);
    entry.deletePassword();
    logger.debug('Deleted credentials from native keyring');
  } catch (error) {
    // Entry might not exist - log for debugging
    logger.debug(`Failed to delete credentials from native keyring: ${error}`);
  }
}

// ============================================================================
// Public API - with caching/coalescing/debounce and instrumentation
// ============================================================================

// Cache & debounce configuration
const CACHE_TTL_MS = 30_000; // 30s cache
const WRITE_DEBOUNCE_MS = 1_000; // 1s debounce for writes

// In-memory state
let _cachedCreds: StoredCredentials | null = null;
let _cacheExpiresAt = 0;
let _inFlightGet: Promise<StoredCredentials | null> | null = null;

// Write queue state
let _pendingWrite: StoredCredentials | null = null;
let _writeTimer: NodeJS.Timeout | null = null;
let _writeInProgress: Promise<void> | null = null;

// Instrumentation
// _getCallCount counts top-level getStoredCredentials() calls
let _getCallCount = 0;
// _backendReadCount counts actual keyring/file reads
let _backendReadCount = 0;
let _writeCount = 0;

function callerStack(): string {
  const stack = new Error().stack || '';
  return stack
    .split('\n')
    .slice(2, 5)
    .map((s) => s.trim())
    .join(' | ');
}

export function getKeyringReadCount(): number {
  // Expose actual backend read count (keyring/file reads)
  return _backendReadCount;
}

export function getGetStoredCallCount(): number {
  return _getCallCount;
}

export function getKeyringWriteCount(): number {
  return _writeCount;
}

export function resetKeyringInstrumentation(): void {
  _getCallCount = 0;
  _backendReadCount = 0;
  _writeCount = 0;
}

async function performPersist(creds: StoredCredentials | null): Promise<void> {
  if (!creds) return;
  _writeCount++;
  logger.debug(`[keychain] performPersist (count=${_writeCount}) caller=${callerStack()}`);

  // Try preferred storage first
  if (shouldUseFileStorage()) {
    try {
      storeCredentialsToFile(creds, getKeyringPassword());
      return;
    } catch (error) {
      logger.warn(`File-based storage persist failed: ${error}`);
      return; // If file storage fails, no further fallback
    }
  }

  try {
    await storeCredentialsToKeyring(creds);
  } catch (error) {
    logger.warn(`Native keyring persist failed, falling back to file storage: ${error}`);
    try {
      storeCredentialsToFile(creds, getKeyringPassword());
    } catch (err) {
      logger.error(`Failed to persist credentials to fallback file storage: ${err}`);
      throw err;
    }
  }
}

function schedulePersist(): void {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    if (_pendingWrite) {
      _writeInProgress = performPersist(_pendingWrite).finally(() => {
        _writeInProgress = null;
        _pendingWrite = null;
      });
    }
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Store credentials securely (uses debounce + coalescing)
 */
export async function storeCredentials(credentials: StoredCredentials): Promise<void> {
  // Update in-memory cache immediately
  _cachedCreds = credentials;
  _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  // Coalesce writes: keep latest and debounce persistence
  _pendingWrite = credentials;
  schedulePersist();
}

/**
 * Flush any pending writes immediately (useful in tests)
 */
export async function flushPendingWrites(): Promise<void> {
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
  if (_pendingWrite) {
    _writeInProgress = performPersist(_pendingWrite).finally(() => {
      _writeInProgress = null;
      _pendingWrite = null;
    });
  }
  if (_writeInProgress) await _writeInProgress;
}

/**
 * Get stored credentials (with cache + coalescing for concurrent reads)
 */
export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  _getCallCount++;
  logger.debug(
    `[keychain] getStoredCredentials called (calls=${_getCallCount}) caller=${callerStack()}`
  );

  const now = Date.now();
  if (_cachedCreds && now < _cacheExpiresAt) {
    return _cachedCreds;
  }

  if (_inFlightGet) return _inFlightGet;

  _inFlightGet = (async () => {
    try {
      let result: StoredCredentials | null;
      _backendReadCount++;
      if (shouldUseFileStorage()) {
        result = getCredentialsFromFile(getKeyringPassword());
      } else {
        try {
          result = getCredentialsFromKeyring();
        } catch (error) {
          logger.warn(`Native keyring failed, trying file storage: ${error}`);
          result = getCredentialsFromFile(getKeyringPassword());
        }
      }

      _cachedCreds = result;
      _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return result;
    } finally {
      _inFlightGet = null;
    }
  })();

  return _inFlightGet;
}

/**
 * Delete stored credentials
 */
export async function deleteStoredCredentials(): Promise<void> {
  // Cancel pending write
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
    _pendingWrite = null;
  }

  // Clear in-memory cache
  _cachedCreds = null;
  _cacheExpiresAt = 0;

  // Try to delete from keyring (best-effort) and file
  try {
    deleteCredentialsFromKeyring();
  } catch (error) {
    logger.debug(`Failed to delete credentials from keyring: ${error}`);
  }
  deleteCredentialsFile();
}

/**
 * Check if credentials are stored
 */
export async function hasStoredCredentials(): Promise<boolean> {
  const creds = await getStoredCredentials();
  return creds !== null;
}

// Re-export getCredentialsFilePath for testing purposes
export { getCredentialsFilePath };

export default {
  storeCredentials,
  getStoredCredentials,
  deleteStoredCredentials,
  hasStoredCredentials,
  flushPendingWrites,
  getKeyringReadCount,
  getKeyringWriteCount,
  resetKeyringInstrumentation,
};
