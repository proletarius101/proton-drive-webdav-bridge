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

const SERVICE_NAME = 'proton-drive-bridge';
const ACCOUNT_NAME = 'proton-drive-bridge:credentials';
const DEFAULT_KEYRING_PASSWORD = 'proton-drive-bridge-default';

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
// Public API
// ============================================================================

/**
 * Store credentials securely
 */
export async function storeCredentials(credentials: StoredCredentials): Promise<void> {
  if (shouldUseFileStorage()) {
    storeCredentialsToFile(credentials, getKeyringPassword());
  } else {
    try {
      await storeCredentialsToKeyring(credentials);
    } catch (error) {
      logger.warn(`Native keyring failed, falling back to file storage: ${error}`);
      storeCredentialsToFile(credentials, getKeyringPassword());
    }
  }
}

/**
 * Get stored credentials
 */
export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  if (shouldUseFileStorage()) {
    return getCredentialsFromFile(getKeyringPassword());
  }

  try {
    return getCredentialsFromKeyring();
  } catch (error) {
    logger.warn(`Native keyring failed, trying file storage: ${error}`);
    return getCredentialsFromFile(getKeyringPassword());
  }
}

/**
 * Delete stored credentials
 */
export async function deleteStoredCredentials(): Promise<void> {
  // Try to delete from both locations
  if (shouldUseFileStorage()) {
    deleteCredentialsFile();
  } else {
    try {
      deleteCredentialsFromKeyring();
    } catch (error) {
      // Log deletion failure but continue
      logger.debug(`Failed to delete credentials from keyring: ${error}`);
    }
  }
  // Also try to delete file in case of previous fallback
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
};
