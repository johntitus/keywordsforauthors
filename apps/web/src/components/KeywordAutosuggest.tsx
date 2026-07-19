import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Keyword input with a typeahead over keywords we've already observed (served by
 * GET /api/keywords/suggest, ranked by search volume). Drops into any form in
 * place of a bare <input>: it keeps the same styling and Enter-to-submit, and
 * adds a suggestion dropdown with mouse + keyboard selection. Suggestions degrade
 * to nothing if the dictionary is empty or D1 is unprovisioned, so it's safe to
 * use before the corpus has filled in.
 */

const INPUT_CLASS =
  "w-full rounded-lg border border-black/10 bg-white px-4 py-3 font-mono text-[15px] text-ink outline-none placeholder:text-muted/50 focus:border-clay";

// Shortest prefix that queries suggestions — keeps hot 2-letter prefixes off the
// server (must match the backend's guard in /api/keywords/suggest).
const MIN_PREFIX = 3;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Fired when a suggestion is chosen (click or Enter on a highlighted row). */
  onPick: (v: string) => void;
  placeholder?: string;
  /** Wrapper layout classes (the input styling is fixed). */
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function KeywordAutosuggest({
  value,
  onChange,
  onPick,
  placeholder,
  className = "min-w-[220px] flex-1",
  disabled,
  autoFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const debounced = useDebounced(value.trim().toLowerCase(), 150);

  const { data } = useQuery({
    queryKey: ["kw-suggest", debounced],
    queryFn: () => api.suggestKeywords(debounced),
    enabled: debounced.length >= MIN_PREFIX,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const suggestions = debounced.length >= MIN_PREFIX ? (data?.suggestions ?? []) : [];
  const showList = open && suggestions.length > 0;

  // A fresh query invalidates the current highlight.
  useEffect(() => setHighlight(-1), [debounced]);

  const pick = (kw: string) => {
    onChange(kw);
    setOpen(false);
    setHighlight(-1);
    onPick(kw);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!suggestions.length) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      if (!showList) return;
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // Accept a highlighted suggestion; otherwise let the form submit the typed value.
      if (showList && highlight >= 0 && suggestions[highlight]) {
        e.preventDefault();
        pick(suggestions[highlight].keyword);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const wrap = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <input
        className={INPUT_CLASS}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(e.target.value.trim().length >= MIN_PREFIX);
        }}
        onFocus={() => setOpen(value.trim().length >= MIN_PREFIX)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          // Keep focus on the input so onBlur doesn't fire before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-black/10 bg-white py-1 shadow-[0_16px_48px_-16px_rgba(44,39,35,0.25)]"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.keyword}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(s.keyword)}
              className={`flex cursor-pointer items-baseline justify-between gap-4 px-4 py-2 font-mono text-sm ${
                i === highlight ? "bg-warm" : ""
              }`}
            >
              <span className="truncate text-ink">{s.keyword}</span>
              <span className="shrink-0 text-xs text-muted">
                {s.searchVolume != null ? s.searchVolume.toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
