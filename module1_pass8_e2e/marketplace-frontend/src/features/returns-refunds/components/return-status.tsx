import { RETURN_STATUS_LABEL, RETURN_STATUS_VALUES } from "../returns-refunds.constants";

type ReturnStatusValue = (typeof RETURN_STATUS_VALUES)[number];

/** Renders one server-owned Return status without giving the browser mutation authority. */
export function ReturnStatus({ value }: { value: ReturnStatusValue }) {
  return (
    <span className="inline-flex rounded-full border bg-slate-50 px-2 py-1 text-xs font-medium">
      {RETURN_STATUS_LABEL[value]}
    </span>
  );
}
