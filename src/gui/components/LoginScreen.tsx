import { useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (!email) {
      setError('Please enter your email');
      return;
    }
    // TODO: Call auth function
  };

  return (
    <Mie.L.View f fc p="large" gr="medium">
      <Mie.Header title="Sign in" subtitle="Connect your Proton Drive account to the WebDAV Bridge" />

      <Mie.L.View f fc gr="small">
        <Mie.L.Text>Email</Mie.L.Text>
        <Mie.Entry
          type="email"
          placeholder="you@proton.me"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          autoComplete="email"
        />
      </Mie.L.View>

      <Mie.Button accent onClick={handleLogin}>
        Continue
      </Mie.Button>
      {error && (
        <Mie.L.Text className="error-message" accent>
          {error}
        </Mie.L.Text>
      )}
    </Mie.L.View>
  );
}
