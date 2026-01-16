/**
 * Proton Drive WebDAV Bridge - Auth Module (Barrel Export)
 *
 * Re-exports authentication functionality for external use.
 */

export { ProtonAuth, restoreSessionFromStorage, authenticateAndStore } from '../auth.js';
export type { Session, ApiError } from '../auth.js';
