import React from 'react';

import { LoginForm } from '@/shared/ui/login-form/login-form';

export default function LoginPage(): React.JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <LoginForm />
      </div>
    </main>
  );
}
