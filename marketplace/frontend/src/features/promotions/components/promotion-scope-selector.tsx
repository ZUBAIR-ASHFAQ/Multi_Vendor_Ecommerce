import { useState } from "react";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { PROMOTION_SCOPE_OPTIONS, PROMOTION_SCOPE_TYPE } from "../promotions.constants";
import { promotionScopeSchema, type PromotionScope } from "../schemas/promotions.schemas";

/** Builds and edits the allow-listed Seller/Store/Category/Product scope targets for one promotion. */
export function PromotionScopeSelector({
  value,
  onChange,
  error,
}: {
  value: PromotionScope[];
  onChange: (value: PromotionScope[]) => void;
  error?: unknown[];
}) {
  const [scopeType, setScopeType] = useState<PromotionScope["scopeType"]>(PROMOTION_SCOPE_TYPE.PRODUCT);
  const [scopeId, setScopeId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const fieldError = firstFieldError(error ?? []);

  /** Validates and adds one unique eligibility target to the form-owned scope array. */
  function addScope(): void {
    const result = promotionScopeSchema.safeParse({ scopeType, scopeId: scopeId.trim() });
    if (!result.success) {
      setAddError(result.error.issues[0]?.message ?? "Enter a valid UUID scope identifier.");
      return;
    }

    const duplicate = value.some(
      (scope) => scope.scopeType === result.data.scopeType && scope.scopeId === result.data.scopeId,
    );
    if (duplicate) {
      setAddError("That promotion scope is already selected.");
      return;
    }

    onChange([...value, result.data]);
    setScopeId("");
    setAddError(null);
  }

  /** Removes one eligibility target from the form-owned scope array. */
  function removeScope(index: number): void {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Eligibility scopes</h3>
        <p className="text-sm text-slate-600">
          Add the Seller, Store, Category, or Product IDs this promotion may target. The API revalidates ownership and existence.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
        <label className="text-sm font-medium">
          Scope type
          <select
            aria-label="Promotion scope type"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as PromotionScope["scopeType"])}
          >
            {PROMOTION_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium">
          Scope UUID
          <input
            aria-label="Promotion scope UUID"
            className="mt-1 w-full rounded-md border px-3 py-2"
            placeholder="00000000-0000-4000-8000-000000000000"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
          />
        </label>

        <Button className="self-end" type="button" variant="outline" onClick={addScope}>
          Add scope
        </Button>
      </div>

      {addError ? <p role="alert" className="text-sm text-red-700">{addError}</p> : null}
      {fieldError ? <p role="alert" className="text-sm text-red-700">{fieldError}</p> : null}

      {value.length === 0 ? (
        <p className="text-sm text-slate-500">No eligibility scope has been added.</p>
      ) : (
        <ul className="space-y-2" aria-label="Selected promotion scopes">
          {value.map((scope, index) => (
            <li
              key={`${scope.scopeType}:${scope.scopeId}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
            >
              <span>
                <strong className="capitalize">{scope.scopeType}</strong>
                <span className="ml-2 font-mono text-xs text-slate-600">{scope.scopeId}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => removeScope(index)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
