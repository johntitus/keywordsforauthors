import { useEffect, useState } from 'react';

/**
 * Small "working…" affordances shared by the three tools.
 *
 * - `ButtonSpinner` — a white spinner sized to sit inline in a clay submit button.
 * - `RotatingStatus` — a playful status line under the input that cycles through
 *   tool-relevant messages every few seconds while the tool is busy, echoing the
 *   way an assistant narrates itself while it thinks.
 */

export function ButtonSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

export function RotatingStatus({
  messages,
  active,
  intervalMs = 2200,
  className = '',
}: {
  messages: string[];
  active: boolean;
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || messages.length <= 1) return;
    const id = setInterval(() => {
      setIndex((n) => (n + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, messages.length]);

  // Reset to the first message whenever a run ends, so the next run starts fresh.
  useEffect(() => {
    if (!active) setIndex(0);
  }, [active]);

  if (!active || messages.length === 0) return null;

  return (
    <p
      aria-live="polite"
      className={`mt-3 flex items-center gap-2 font-mono text-sm text-muted ${className}`}
    >
      <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-clay/25 border-t-clay" />
      <span key={index} className="[animation:kfa-status-fade_0.45s_ease]">
        {messages[index]}
      </span>
    </p>
  );
}
