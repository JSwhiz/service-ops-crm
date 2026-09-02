import React, { useId } from 'react';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';
type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info';
type SurfaceTone = 'default' | 'subtle' | 'inset';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={classes(
        'ui-button',
        variant !== 'default' && `ui-button--${variant}`,
        size !== 'md' && `ui-button--${size}`,
        fullWidth && 'ui-button--full',
        className,
      )}
      {...props}
    />
  );
}

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string;
}

export function IconButton({
  className,
  type = 'button',
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={classes('ui-icon-button', className)}
      {...props}
    />
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={classes(
        'ui-badge',
        tone !== 'neutral' && `ui-badge--${tone}`,
        className,
      )}
      {...props}
    />
  );
}

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone;
}

export function Surface({
  tone = 'default',
  className,
  ...props
}: SurfaceProps): React.JSX.Element {
  return (
    <div
      className={classes(
        'ui-surface',
        tone !== 'default' && `ui-surface--${tone}`,
        className,
      )}
      {...props}
    />
  );
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className={classes('ui-empty-state', className)} {...props}>
      <p className="ui-empty-state__title">{title}</p>
      {description ? (
        <p className="ui-empty-state__description">{description}</p>
      ) : null}
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </div>
  );
}

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  width,
  height,
  className,
  style,
  ...props
}: SkeletonProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={classes('ui-skeleton', className)}
      style={{ ...style, width, height }}
      {...props}
    />
  );
}

export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: string;
  children: React.ReactNode;
}

export function Tooltip({
  label,
  children,
  className,
  ...props
}: TooltipProps): React.JSX.Element {
  const tooltipId = useId();

  return (
    <span className={classes('ui-tooltip', className)} {...props}>
      <span aria-describedby={tooltipId}>{children}</span>
      <span id={tooltipId} role="tooltip" className="ui-tooltip__content">
        {label}
      </span>
    </span>
  );
}
