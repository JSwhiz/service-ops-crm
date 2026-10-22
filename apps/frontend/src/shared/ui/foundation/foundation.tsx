import Link from 'next/link';
import React, { useId } from 'react';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';
type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info';
type SurfaceTone = 'default' | 'subtle' | 'inset';
type AlertTone = 'info' | 'success' | 'warning' | 'danger';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  pending?: boolean;
  pendingLabel?: React.ReactNode;
  /** Leading icon, e.g. <PlusIcon /> for create actions. */
  icon?: React.ReactNode;
}

function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  className?: string,
): string {
  return classes(
    'ui-button',
    variant !== 'default' && `ui-button--${variant}`,
    size !== 'md' && `ui-button--${size}`,
    fullWidth && 'ui-button--full',
    className,
  );
}

export function Button({
  variant = 'default',
  size = 'md',
  fullWidth = false,
  pending = false,
  pendingLabel,
  icon,
  className,
  type = 'button',
  disabled,
  children,
  'aria-busy': ariaBusy,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, fullWidth, className)}
      disabled={disabled || pending}
      aria-busy={pending || ariaBusy}
      {...props}
    >
      {pending && pendingLabel ? (
        <span className="ui-button__pending-content">
          <span>{pendingLabel}</span>
          <span className="ui-button__label-placeholder" aria-hidden="true">
            {children}
          </span>
        </span>
      ) : (
        <>
          {icon ? <span className="ui-button__icon" aria-hidden="true">{icon}</span> : null}
          {children}
        </>
      )}
    </button>
  );
}

export interface ButtonLinkProps
  extends Omit<React.ComponentProps<typeof Link>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

/** Navigation styled exactly like Button (same height, focus and hover states). */
export function ButtonLink({
  variant = 'default',
  size = 'md',
  fullWidth = false,
  icon,
  className,
  children,
  ...props
}: ButtonLinkProps): React.JSX.Element {
  return (
    <Link className={buttonClassName(variant, size, fullWidth, className)} {...props}>
      {icon ? <span className="ui-button__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </Link>
  );
}

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  title?: React.ReactNode;
  action?: React.ReactNode;
}

export function Alert({
  tone = 'info',
  title,
  action,
  className,
  children,
  ...props
}: AlertProps): React.JSX.Element {
  return (
    <div
      className={classes('ui-alert', `ui-alert--${tone}`, className)}
      {...props}
    >
      <div className="ui-alert__content">
        {title ? <p className="ui-alert__title">{title}</p> : null}
        <div className="ui-alert__message">{children}</div>
      </div>
      {action ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  );
}

interface FieldControlProps {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
}

export interface FieldProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactElement<FieldControlProps>;
}

export function Field({
  label,
  description,
  error,
  required = false,
  children,
  className,
  ...props
}: FieldProps): React.JSX.Element {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, descriptionId, children.props['aria-describedby']]
    .filter(Boolean)
    .join(' ') || undefined;
  const control = React.cloneElement(children, {
    id: controlId,
    required: required || children.props.required,
    'aria-required': required || children.props['aria-required'],
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-describedby': describedBy,
  });

  return (
    <div className={classes('ui-field', className)} {...props}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
        {required ? <span className="ui-field__required" aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {error ? (
        <div id={errorId} className="ui-field__error">
          {error}
        </div>
      ) : null}
      {description ? (
        <div id={descriptionId} className="ui-field__description">
          {description}
        </div>
      ) : null}
    </div>
  );
}

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  context?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  context,
  actions,
  className,
  ...props
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className={classes('ui-page-header', className)} {...props}>
      <div className="ui-page-header__content">
        {context ? <div className="ui-page-header__context">{context}</div> : null}
        <h1 className="ui-page-header__title">{title}</h1>
        {description ? <div className="ui-page-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface EntityHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  metadata?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
}

export function EntityHeader({
  title,
  metadata,
  status,
  actions,
  className,
  ...props
}: EntityHeaderProps): React.JSX.Element {
  return (
    <header className={classes('ui-entity-header', className)} {...props}>
      <div className="ui-entity-header__content">
        <div className="ui-entity-header__identity">
          <h1 className="ui-entity-header__title">{title}</h1>
          {status ? <div className="ui-entity-header__status">{status}</div> : null}
        </div>
        {metadata ? <div className="ui-entity-header__metadata">{metadata}</div> : null}
      </div>
      {actions ? <div className="ui-entity-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string;
  /** Outlined like a default Button; use next to other header actions. */
  bordered?: boolean;
}

export function IconButton({
  className,
  type = 'button',
  bordered = false,
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={classes('ui-icon-button', bordered && 'ui-icon-button--bordered', className)}
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

const STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success', completed: 'success', closed: 'success', in_storage: 'success',
  in_progress: 'info', assigned_to_object: 'info', assigned_to_one_time_order: 'info',
  awaiting_confirmation: 'warning', pending_auto_close: 'warning', partially_completed: 'warning',
  under_repair: 'warning', frozen: 'warning', attention: 'warning', pending: 'warning',
  broken: 'danger', lost: 'danger', written_off: 'danger', cancelled: 'danger',
  archived: 'danger', rejected: 'danger',
};

export interface StatusBadgeProps extends BadgeProps {
  /** Domain status code; its tone comes from one shared map (unknown codes stay neutral). */
  status?: string | null;
}

/** Badge for workflow statuses (orders, tasks, equipment, objects, accountability). */
export function StatusBadge({ status, tone, ...props }: StatusBadgeProps): React.JSX.Element {
  return <Badge tone={tone ?? (status ? STATUS_TONES[status] : undefined) ?? 'neutral'} data-status={status ?? undefined} {...props} />;
}

export interface BackLinkProps extends Omit<React.ComponentProps<typeof Link>, 'className'> {
  className?: string;
}

/** «← Раздел» link above an entity header. */
export function BackLink({ className, children, ...props }: BackLinkProps): React.JSX.Element {
  return (
    <Link className={classes('ui-back-link', className)} {...props}>
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  );
}

export interface Fact {
  label: React.ReactNode;
  value: React.ReactNode;
  key?: string;
}

export interface FactStripProps extends React.HTMLAttributes<HTMLDListElement> {
  items: Fact[];
}

/** Key facts under an entity header: a bordered strip of label/value cells (4 → 2 → 1 columns). */
export function FactStrip({ items, className, ...props }: FactStripProps): React.JSX.Element {
  return (
    <dl className={classes('ui-fact-strip', className)} {...props}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className="ui-fact-strip__item">
          <dt className="ui-fact-strip__label">{item.label}</dt>
          <dd className="ui-fact-strip__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Vertical gap from the spacing scale: xs 4 · sm 8 · md 12 · lg 16 · xl 24 px. */
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

/** Vertical layout with token spacing; replaces ad-hoc `display: grid; gap` inline styles. */
export function Stack({ gap = 'md', className, ...props }: StackProps): React.JSX.Element {
  return <div className={classes('ui-stack', `ui-stack--${gap}`, className)} {...props} />;
}

export interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  tone?: SurfaceTone;
  /** Inner spacing: `md` for sections, `sm` for list items. */
  padding?: 'none' | 'sm' | 'md';
  /** Semantic element; the look stays the same. */
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'li';
}

export function Surface({
  tone = 'default',
  padding = 'none',
  as: Element = 'div',
  className,
  ...props
}: SurfaceProps): React.JSX.Element {
  return (
    <Element
      className={classes(
        'ui-surface',
        tone !== 'default' && `ui-surface--${tone}`,
        padding === 'md' && 'ui-surface--padded',
        padding === 'sm' && 'ui-surface--compact',
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

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
}

/** Placeholder while a list or card loads; announced to assistive tech. */
export function LoadingState({ label = 'Загрузка…', className, ...props }: LoadingStateProps): React.JSX.Element {
  return (
    <div className={classes('ui-loading-state', className)} role="status" aria-live="polite" aria-busy="true" {...props}>
      <span className="ui-loading-state__spinner" aria-hidden="true" />
      {label}
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
