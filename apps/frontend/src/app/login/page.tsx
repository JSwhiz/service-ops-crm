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
              <span>Workspace</span>
            </span>
          </div>

          <div className={styles.brandCopy}>
            <span className={styles.eyebrow}>Операционная система</span>
            <h1>Вся ежедневная работа — в одном пространстве.</h1>
            <p>
              Объекты, сотрудники, задачи, расходники и оборудование без лишних
              переходов между сервисами.
            </p>
          </div>

          <div className={styles.brandFooter}>
            <span>Внутренний доступ</span>
            <span>Service Ops</span>
          </div>
        </aside>

        <div className={styles.formPane}>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
