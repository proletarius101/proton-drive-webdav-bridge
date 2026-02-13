import { useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { useElectron } from '../electron/ElectronProvider';

/**
 * Type guard to check if result is an AuthResult
 */
function isAuthResult(data: unknown): data is {
  success: boolean;
  requires2FA?: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
} {
  return typeof data === 'object' && data !== null && 'success' in data;
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'password' | '2fa' | 'mailbox'>('email');
  const [code, setCode] = useState('');
  const [mailboxPassword, setMailboxPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const electron = useElectron();

  const handleEmailSubmit = async () => {
    if (!email) {
      setError('Please enter your email');
      return;
    }

    // Move to password step
    setError('');
    setStep('password');
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await electron.invoke('auth:login', { email, password });

      if (!isAuthResult(result)) {
        setError('Invalid response from server');
        setStep('password');
        return;
      }

      if (result.success) {
        // Login successful - parent App will detect auth state change
        return;
      }

      // Handle 2FA requirement
      if (result.requires2FA) {
        setStep('2fa');
      } else if (result.requiresMailboxPassword) {
        setStep('mailbox');
      } else {
        setError(result.error || 'Login failed. Please try again.');
        setStep('password');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(errorMessage);
      setStep('password');
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async () => {
    if (!code) {
      setError('Please enter the 2FA code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await electron.invoke('auth:submit2FA', { code });

      if (!isAuthResult(result)) {
        setError('Invalid response from server');
        return;
      }

      if (result.success) {
        // Auth complete
        return;
      }

      if (result.requiresMailboxPassword) {
        setStep('mailbox');
      } else {
        setError(result.error || '2FA verification failed. Please try again.');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '2FA verification failed. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleMailboxPasswordSubmit = async () => {
    if (!mailboxPassword) {
      setError('Please enter your mailbox password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await electron.invoke('auth:submitMailboxPassword', {
        password: mailboxPassword,
      });

      if (!isAuthResult(result)) {
        setError('Invalid response from server');
        return;
      }

      if (result.success) {
        // Auth complete
        return;
      }

      setError(result.error || 'Mailbox password verification failed. Please try again.');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Mailbox password verification failed. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Mie.L.View f fc p="large" gr="medium">
      <Mie.Header
        title="Sign in"
        subtitle="Connect your Proton Drive account to the WebDAV Bridge"
      />

      {step === 'email' && (
        <>
          <Mie.L.View f fc gr="small">
            <Mie.L.Text>Email or Username</Mie.L.Text>
            <Mie.Entry
              type="email"
              placeholder="you@proton.me"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              autoComplete="email"
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
            />
          </Mie.L.View>

          <Mie.Button accent onClick={handleEmailSubmit} disabled={loading}>
            Continue
          </Mie.Button>
        </>
      )}

      {step === 'password' && (
        <>
          <Mie.L.View f fc gr="small">
            <Mie.L.Text>Email: {email}</Mie.L.Text>
            <Mie.L.Text style={{ fontSize: '0.9em', opacity: 0.7 }}>Password</Mie.L.Text>
            <Mie.Entry
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoComplete="current-password"
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
            />
          </Mie.L.View>

          <Mie.Button accent onClick={handlePasswordSubmit} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Mie.Button>

          <Mie.Button
            transparent
            onClick={() => {
              setStep('email');
              setPassword('');
              setError('');
            }}
          >
            Back
          </Mie.Button>
        </>
      )}

      {step === '2fa' && (
        <>
          <Mie.L.View f fc gr="small">
            <Mie.L.Text>Two-Factor Code</Mie.L.Text>
            <Mie.Entry
              type="text"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handle2FASubmit()}
            />
          </Mie.L.View>

          <Mie.Button accent onClick={handle2FASubmit} disabled={loading}>
            {loading ? 'Verifying...' : 'Verify'}
          </Mie.Button>
        </>
      )}

      {step === 'mailbox' && (
        <>
          <Mie.L.View f fc gr="small">
            <Mie.L.Text>Mailbox Password</Mie.L.Text>
            <Mie.Entry
              type="password"
              placeholder="••••••••"
              value={mailboxPassword}
              onChange={(e) => setMailboxPassword(e.currentTarget.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handleMailboxPasswordSubmit()}
            />
          </Mie.L.View>

          <Mie.Button accent onClick={handleMailboxPasswordSubmit} disabled={loading}>
            {loading ? 'Verifying...' : 'Continue'}
          </Mie.Button>
        </>
      )}

      {error && (
        <Mie.L.Text className="error-message" accent>
          {error}
        </Mie.L.Text>
      )}
    </Mie.L.View>
  );
}
