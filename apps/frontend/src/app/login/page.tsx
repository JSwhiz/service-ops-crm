import React from 'react';

import { LoginForm } from '@/shared/ui/login-form/login-form';

import styles from './login.module.css';

export default function LoginPage(): React.JSX.Element {
  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <aside className={styles.brandPane}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              SO
            </span>
            <span className={styles.brandText}>
              <strong>Service Ops</strong>
            </span>
          </div>

          <div className={styles.brandCopy}>
            <h1>Вся ежедневная работа — в одном пространстве.</h1>
          </div>
        </aside>

        <div className={styles.formPane}>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
