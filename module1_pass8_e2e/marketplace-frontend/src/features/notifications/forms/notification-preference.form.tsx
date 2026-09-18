import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_CHANNEL_VALUES,
} from "../notifications.constants";
import { notificationPreferenceFormSchema } from "../schemas/notifications.schemas";
import type { NotificationPreference } from "../types/notifications.types";

/** Collects one editable event/channel preference; server policy remains authoritative for mandatory channels. */
export function NotificationPreferenceForm({
  initialValue,
  isPending,
  error,
  onSave,
}: {
  initialValue?: NotificationPreference;
  isPending: boolean;
  error: unknown;
  onSave: (preference: NotificationPreference) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      eventCode: initialValue?.eventCode ?? "",
      channel: initialValue?.channel ?? "in_app",
      enabled: initialValue?.enabled ?? true,
    } as NotificationPreference,
    validators: { onChange: notificationPreferenceFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSave(notificationPreferenceFormSchema.parse(value));
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm md:grid-cols-[1fr_10rem_10rem_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="eventCode">
        {(field) => {
          const message = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Event code
              <input
                aria-label="Notification event code"
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="order.created"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toLowerCase().trim())}
              />
              {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="channel">
        {(field) => (
          <label className="text-sm font-medium">
            Channel
            <select
              aria-label="Notification channel"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as NotificationPreference["channel"])}
            >
              {NOTIFICATION_CHANNEL_VALUES.map((channel) => (
                <option key={channel} value={channel}>{NOTIFICATION_CHANNEL_LABEL[channel]}</option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="enabled">
        {(field) => (
          <label className="text-sm font-medium">
            Preference
            <select
              aria-label="Notification preference enabled"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value ? "enabled" : "disabled"}
              onChange={(event) => field.handleChange(event.target.value === "enabled")}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        )}
      </form.Field>

      <div className="self-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : initialValue ? "Update preference" : "Save preference"}
        </Button>
      </div>
      <div className="md:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}
