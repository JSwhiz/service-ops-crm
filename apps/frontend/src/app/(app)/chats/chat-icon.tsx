import React from 'react';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

type ChatIconName =
  | 'search'
  | 'close'
  | 'compose'
  | 'more'
  | 'attach'
  | 'send'
  | 'heart'
  | 'reply'
  | 'forward'
  | 'edit'
  | 'trash'
  | 'archive'
  | 'gallery'
  | 'file'
  | 'back';

export function ChatIcon({ name }: { name: ChatIconName }): React.JSX.Element {
  if (
    name === 'close' ||
    name === 'edit' ||
    name === 'trash' ||
    name === 'archive' ||
    name === 'gallery' ||
    name === 'file'
  ) {
    return <MediaActionIcon name={name} />;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'search' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4 4" />
        </>
      ) : null}
      {name === 'compose' ? (
        <>
          <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 4l6 6M10 14l4-1L22 5l-3-3-8 8-1 4Z" />
        </>
      ) : null}
      {name === 'more' ? (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      ) : null}
      {name === 'attach' ? (
        <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a2 2 0 0 1 3 3l-9 9" />
      ) : null}
      {name === 'send' ? <path d="m3 3 18 9-18 9 3-9-3-9Zm3 9h15" /> : null}
      {name === 'heart' ? (
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      ) : null}
      {name === 'reply' ? (
        <path d="m10 5-7 7 7 7v-5c5 0 8 1 11 5-1-7-4-10-11-10V5Z" />
      ) : null}
      {name === 'forward' ? (
        <path d="m14 5 7 7-7 7v-5c-5 0-8 1-11 5 1-7 4-10 11-10V5Z" />
      ) : null}
      {name === 'back' ? <path d="m14 5-7 7 7 7M7 12h14" /> : null}
    </svg>
  );
}
