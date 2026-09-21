import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useModalFocus } from "@/hooks/use-modal-focus";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

/** Modal confirmation for irreversible or high-impact commands. */
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep unchanged",
  isPending = false,
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus(dialogRef, open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface p-5 text-foreground shadow-elevated sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-foreground-muted">{description}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>{cancelLabel}</Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={isPending}
            aria-busy={isPending}
            onClick={onConfirm}
          >
            {isPending ? "Working..." : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
