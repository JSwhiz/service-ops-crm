'use client';

import Link from 'next/link';
import React from 'react';

import styles from './dashboard-primitives.module.css';

export type DashboardTone = 'neutral' | 'warning' | 'danger';

export function DashboardPanel(props: {
  title: string;
  count?: number | null;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { title, count, actionHref, actionLabel, children } = props;
  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <h2>{title}</h2>
          {typeof count === 'number' ? <span className={styles.count}>{count}</span> : null}
        </div>
        {actionHref && actionLabel ? <Link className={styles.headAction} href={actionHref}>{actionLabel}</Link> : null}
      </header>
      {children}
    </section>
  );
}

export function DashboardRows({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={styles.rows}>{children}</div>;
}

export function DashboardBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: DashboardTone }): React.JSX.Element {
  return <span className={`${styles.badge} ${tone === 'danger' ? styles.danger : tone === 'warning' ? styles.warning : ''}`}>{children}</span>;
}

export function DashboardRow(props: {
  title: string;
  subtitle?: string | null;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  tone?: DashboardTone;
  onClick?: () => void;
  href?: string;
  className?: string;
}): React.JSX.Element {
  const { title, subtitle, meta, badge, tone = 'neutral', onClick, href, className = '' } = props;
  const content = (
    <>
      {badge ? <DashboardBadge tone={tone}>{badge}</DashboardBadge> : null}
      <span className={styles.copy}>
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </>
  );
  const classes = `${styles.row} ${className}`.trim();
  return href
    ? <Link href={href} className={classes}>{content}</Link>
    : <button type="button" className={classes} onClick={onClick}>{content}</button>;
}

export function DashboardEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={styles.empty}>{children}</div>;
}

export function DashboardSummaryStrip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <section className={styles.summaryStrip}><div className={styles.summaryLabel}>{label}</div>{children}</section>;
}

export function DashboardMetric(props: { value: React.ReactNode; label: string; alert?: boolean; onClick?: () => void; href?: string }): React.JSX.Element {
  const { value, label, alert = false, onClick, href } = props;
  const content = <><strong>{value}</strong><span>{label}</span></>;
  const classes = `${styles.metric} ${alert ? styles.metricAlert : ''}`;
  return href ? <Link href={href} className={classes}>{content}</Link> : <button type="button" className={classes} onClick={onClick}>{content}</button>;
}

export function DashboardKpiGrid({ columns, children }: { columns: 2 | 3; children: React.ReactNode }): React.JSX.Element {
  return <div className={columns === 2 ? styles.kpiGrid2 : styles.kpiGrid3}>{children}</div>;
}

export function DashboardKpi(props: { value: React.ReactNode; label: string; meta?: string; onClick?: () => void; href?: string }): React.JSX.Element {
  const { value, label, meta, onClick, href } = props;
  const content = <><span>{label}</span><strong>{value}</strong>{meta ? <small>{meta}</small> : null}</>;
  return href ? <Link href={href} className={styles.kpi}>{content}</Link> : <button type="button" className={styles.kpi} onClick={onClick}>{content}</button>;
}
