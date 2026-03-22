import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface FilterableMultiSelectProps {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  onCreateNew?: (name: string) => Promise<void>;
  placeholder?: string;
  required?: boolean;
}

export function FilterableMultiSelect({
  options,
  values,
  onChange,
  onCreateNew,
  placeholder = "Начните вводить...",
  required,
}: FilterableMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Options not yet selected
  const available = options.filter((o) => !values.includes(o.value));

  // Filtered by query
  const filtered = query
    ? available.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : available;

  // Whether to show "Create new" button
  const trimmedQuery = query.trim();
  const canCreate =
    onCreateNew &&
    trimmedQuery.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase());

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, isOpen]);

  const addValue = useCallback(
    (val: string) => {
      if (!values.includes(val)) {
        onChange([...values, val]);
      }
      setQuery("");
      setHighlightIndex(0);
    },
    [values, onChange],
  );

  const removeValue = useCallback(
    (val: string) => {
      onChange(values.filter((v) => v !== val));
    },
    [values, onChange],
  );

  async function handleCreateNew() {
    if (!onCreateNew || !trimmedQuery || isCreating) return;
    setIsCreating(true);
    try {
      await onCreateNew(trimmedQuery);
      addValue(trimmedQuery);
    } finally {
      setIsCreating(false);
    }
  }

  // Total items in dropdown (filtered + create button)
  const totalItems = filtered.length + (canCreate ? 1 : 0);

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, totalItems - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIndex < filtered.length) {
          addValue(filtered[highlightIndex].value);
        } else if (canCreate) {
          handleCreateNew();
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setQuery("");
        break;
      case "Backspace":
        if (!query && values.length > 0) {
          removeValue(values[values.length - 1]);
        }
        break;
    }
  }

  function handleInputChange(val: string) {
    setQuery(val);
    setHighlightIndex(0);
    if (!isOpen) setIsOpen(true);
  }

  const selectedLabels = values.map((v) => {
    const opt = options.find((o) => o.value === v);
    return { value: v, label: opt?.label ?? v };
  });

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips + input */}
      <div
        className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
        onClick={() => inputRef.current?.focus()}
      >
        {selectedLabels.map((item) => (
          <span
            key={item.value}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-sm font-medium text-blue-700"
          >
            {item.label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeValue(item.value);
              }}
              className="ml-0.5 text-blue-400 hover:text-blue-600"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[80px] flex-1 border-none bg-transparent text-sm outline-none"
          autoComplete="off"
        />
      </div>

      {/* Hidden input for required validation */}
      {required && values.length === 0 && (
        <input
          tabIndex={-1}
          autoComplete="off"
          style={{ opacity: 0, height: 0, position: "absolute", pointerEvents: "none" }}
          value=""
          required
          onChange={() => {}}
        />
      )}

      {/* Dropdown */}
      {isOpen && totalItems > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                addValue(opt.value);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                idx === highlightIndex
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </li>
          ))}
          {canCreate && (
            <li
              onMouseDown={(e) => {
                e.preventDefault();
                handleCreateNew();
              }}
              onMouseEnter={() => setHighlightIndex(filtered.length)}
              className={`cursor-pointer border-t border-gray-100 px-3 py-2 text-sm ${
                highlightIndex === filtered.length
                  ? "bg-green-50 text-green-700"
                  : "text-green-600 hover:bg-green-50"
              }`}
            >
              {isCreating ? "Создание..." : `Создать "${trimmedQuery}"`}
            </li>
          )}
        </ul>
      )}

      {isOpen && query && filtered.length === 0 && !canCreate && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-center text-sm text-gray-400 shadow-lg">
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
