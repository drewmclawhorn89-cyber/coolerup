import { ArrowLeft, Search, X } from "lucide-react";
import { forwardRef, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter and on the "Search" button. */
  onSubmit?: (value: string) => void;
  onBack?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
};

/**
 * TikTok-style search bar: back arrow, dark rounded field with a magnifier,
 * a clear X once there's text, and a pink "Search" action on the right.
 */
export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, onChange, onSubmit, onBack, autoFocus = true, placeholder = "Search" },
  ref,
) {
  const submit = () => onSubmit?.(value);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") onBack?.();
  };

  return (
    <div className="flex items-center gap-2 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[#2a2a2a] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
        <input
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45 [&::-webkit-search-cancel-button]:hidden"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 text-white transition hover:bg-white/35"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        className="shrink-0 px-1 text-[15px] font-semibold text-[#fe2c55] transition active:opacity-70"
      >
        Search
      </button>
    </div>
  );
});
