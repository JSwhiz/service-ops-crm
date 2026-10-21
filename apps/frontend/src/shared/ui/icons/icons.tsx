import React from 'react';

/**
 * Line icons used across the CRM. One stroke style (1.7 px on a 20 px grid,
 * currentColor); size is set by the consumer's CSS or the `size` prop.
 */
interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function Icon({ size, children, ...props }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M10 4v12M4 10h12" /></Icon>;
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" /></Icon>;
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></Icon>;
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.3 3.3" /></Icon>;
}

export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="m6 8 4 4 4-4" /></Icon>;
}

export function ChevronLeftIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M12.5 4.5 7 10l5.5 5.5" /></Icon>;
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M7.5 4.5 13 10l-5.5 5.5" /></Icon>;
}

export function ArrowRightIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M5 10h10m-3.5-3.5L15 10l-3.5 3.5" /></Icon>;
}

export function CalendarIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></Icon>;
}

export function DownloadIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 15.5h12" /></Icon>;
}

export function PencilIcon(props: IconProps): React.JSX.Element {
  return <Icon {...props}><path d="M13.5 3.5a1.8 1.8 0 0 1 2.5 2.5L7 15l-3.5 1 1-3.5 9-9Z" /><path d="m12 5 3 3" /></Icon>;
}
