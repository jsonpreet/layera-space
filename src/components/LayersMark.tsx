export function LayersMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <path d="M32 8 L56 20 L32 32 L8 20 Z" fill="#c98f52" />
      <path d="M32 24 L56 36 L32 48 L8 36 Z" fill="#a06b38" />
      <path d="M32 40 L56 52 L32 64 L8 52 Z" fill="#6f4a26" />
    </svg>
  );
}
