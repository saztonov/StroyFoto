import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";

export interface FilterableSelectOption {
  value: string;
  label: string;
}

interface FilterableSelectProps {
  options: FilterableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew?: (name: string) => Promise<void>;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FilterableSelect({
  options,
  value,
  onChange,
  onCreateNew,
  placeholder = "Начните вводить...",
  required,
  disabled,
}: FilterableSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Display label for the selected value
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  // Filtered options based on query
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Whether to show "Create new" button
  const trimmedQuery = query.trim();
  const canCreate =
    onCreateNew &&
    trimmedQuery.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase());

  const totalItems = filtered.length + (canCreate ? 1 : 0);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Restore selected label when closing without selection
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

  const selectOption = useCallback(
    (opt: FilterableSelectOption) => {
      onChange(opt.value);
      setQuery("");
      setIsOpen(false);
    },
    [onChange],
  );

  async function handleCreateNew() {
    if (!onCreateNew || !trimmedQuery || isCreating) return;
    setIsCreating(true);
    try {
      await onCreateNew(trimmedQuery);
      onChange(trimmedQuery);
      setQuery("");
      setIsOpen(false);
    } finally {
      setIsCreating(false);
    }
  }

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
          selectOption(filtered[highlightIndex]);
        } else if (canCreate) {
          handleCreateNew();
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setQuery("");
        break;
    }
  }

  function handleInputChange(val: string) {
    setQuery(val);
    setHighlightIndex(0);
    if (!isOpen) setIsOpen(true);
  }

  function handleFocus() {
    setIsOpen(true);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? query : selectedLabel}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required && !value}
        disabled={disabled}
        className="input-field"
        autoComplete="off"
      />
      {value && !isOpen && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          tabIndex={-1}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isOpen && totalItems > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg"
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                idx === highlightIndex
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : opt.value === value
                    ? "bg-gray-50 dark:bg-gray-700 font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
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
              className={`cursor-pointer border-t border-gray-100 dark:border-gray-700 px-3 py-2 text-sm ${
                highlightIndex === filtered.length
                  ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  : "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
              }`}
            >
              {isCreating ? "Создание..." : `Создать "${trimmedQuery}"`}
            </li>
          )}
        </ul>
      )}

      {isOpen && query && filtered.length === 0 && !canCreate && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 text-center text-sm text-gray-400 dark:text-gray-500 shadow-lg">
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
