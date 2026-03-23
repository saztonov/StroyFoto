import type { FilterableSelectOption } from "../FilterableSelect";
import { FilterableSelect } from "../FilterableSelect";
import type { MultiSelectOption } from "../FilterableMultiSelect";
import { FilterableMultiSelect } from "../FilterableMultiSelect";

interface ReportFiltersProps {
  dateFrom: string;
  dateTo: string;
  contractorFilter: string;
  descriptionSearch: string;
  workTypeFilter: string[];
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onContractorChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onWorkTypeChange: (v: string[]) => void;
  onClear: () => void;
  contractorOptions: FilterableSelectOption[];
  workTypeOptions: MultiSelectOption[];
}

export function ReportFilters({
  dateFrom,
  dateTo,
  contractorFilter,
  descriptionSearch,
  workTypeFilter,
  onDateFromChange,
  onDateToChange,
  onContractorChange,
  onDescriptionChange,
  onWorkTypeChange,
  onClear,
  contractorOptions,
  workTypeOptions,
}: ReportFiltersProps) {
  const hasAnyFilter = dateFrom || dateTo || contractorFilter || descriptionSearch || workTypeFilter.length > 0;

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Date range */}
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">С</p>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">По</p>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
          />
        </div>

        {/* Contractor */}
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Подрядчик</p>
          <FilterableSelect
            options={contractorOptions}
            value={contractorFilter}
            onChange={onContractorChange}
            placeholder="Все подрядчики"
          />
        </div>

        {/* Description search */}
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Поиск по описанию</p>
          <input
            type="text"
            value={descriptionSearch}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Введите текст..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Work types - full width */}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Виды работ</p>
        <FilterableMultiSelect
          options={workTypeOptions}
          values={workTypeFilter}
          onChange={onWorkTypeChange}
          placeholder="Все виды работ"
        />
      </div>

      {/* Clear filters */}
      {hasAnyFilter && (
        <button
          onClick={onClear}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Сбросить фильтры
        </button>
      )}
    </div>
  );
}
