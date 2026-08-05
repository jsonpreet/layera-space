function base(props: { className?: string }) {
  return {
    width: 13,
    height: 13,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    className: props.className,
  };
}

export function IconClose({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5" />
    </svg>
  );
}

export function IconSplitH({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M8 3.5 V12.5" />
    </svg>
  );
}

export function IconSplitV({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M3 8 H13" />
    </svg>
  );
}

export function IconZoom({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M2.5 6 V3.5 A1 1 0 0 1 3.5 2.5 H6" />
      <path d="M10 2.5 H12.5 A1 1 0 0 1 13.5 3.5 V6" />
      <path d="M13.5 10 V12.5 A1 1 0 0 1 12.5 13.5 H10" />
      <path d="M6 13.5 H3.5 A1 1 0 0 1 2.5 12.5 V10" />
    </svg>
  );
}

export function IconPlus({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M8 3.5 V12.5 M3.5 8 H12.5" />
    </svg>
  );
}

export function IconChevron({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M4 6.5 L8 10.5 L12 6.5" />
    </svg>
  );
}

export function IconRefreshCw({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M13 8 A5 5 0 0 1 3.5 10.5" />
      <path d="M3 8 A5 5 0 0 1 12.5 5.5" />
      <path d="M13 4.5 V8 H9.5" />
      <path d="M3 11.5 V8 H6.5" />
    </svg>
  );
}

export function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg {...base({ className })}>
      <path d="M9 3.5 H12.5 V7" />
      <path d="M12.5 3.5 L7.5 8.5" />
      <path d="M12.5 9.5 V12 A1 1 0 0 1 11.5 13 H4 A1 1 0 0 1 3 12 V4.5 A1 1 0 0 1 4 3.5 H6.5" />
    </svg>
  );
}
