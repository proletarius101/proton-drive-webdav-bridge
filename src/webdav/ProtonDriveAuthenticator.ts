/**
 * Proton Drive Authenticator for Nephele
 *
 * Simple authenticator that allows all requests (authentication is handled by middleware).
 */

import type { Request } from 'express';
import type { Authenticator as AuthenticatorInterface, AuthResponse, User } from 'nephele';

export default class ProtonDriveAuthenticator implements AuthenticatorInterface {
  async authenticate(_request: Request, response: AuthResponse): Promise<User> {
    // Authentication is already handled by Express middleware
    // Just return a default user
    response.locals.user = {
      username: 'proton-user',
      uid: 1000,
      gid: 1000,
    };

    return response.locals.user;
  }

  async cleanAuthentication(_request: Request, _response: AuthResponse): Promise<void> {
    // No cleanup needed - authentication is handled by Express middleware
  }
}
