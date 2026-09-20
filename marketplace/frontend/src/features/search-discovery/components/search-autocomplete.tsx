import { useDebouncedSearchText, useSearchSuggestionsQuery } from "../hooks/use-search-discovery";

/** Displays bounded public autocomplete suggestions beneath the Search text field. */
export function SearchAutocomplete({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (suggestion: string) => void;
}) {
  const debounced = useDebouncedSearchText(value);
  const suggestions = useSearchSuggestionsQuery(debounced);

  if (value.trim().length < 2 || suggestions.isPending || !suggestions.data?.length) {
    return null;
  }

  return (
    <div className="search-autocomplete absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg">
      <p className="search-autocomplete-heading border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Suggestions
      </p>
      <ul>
        {suggestions.data.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              className="search-autocomplete-option w-full px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50"
              onClick={() => onSelect(suggestion)}
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
