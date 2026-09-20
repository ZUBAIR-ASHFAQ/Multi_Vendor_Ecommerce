import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
import { ApiClientError } from "@/lib/api-error";
import { NotificationPreferenceForm } from "../forms/notification-preference.form";
import {
  useNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from "../hooks/use-notifications";
import {
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATIONS_PERMISSION,
} from "../notifications.constants";
import type { NotificationPreference } from "../types/notifications.types";

/** Merges one edited preference into the replace-all payload without duplicating its event/channel identity. */
function mergePreference(
  current: NotificationPreference[],
  next: NotificationPreference,
  previous?: NotificationPreference,
): NotificationPreference[] {
  const withoutEdited = current.filter((item) => {
    const matchesPrevious = previous
      ? item.eventCode === previous.eventCode && item.channel === previous.channel
      : false;
    const matchesNext = item.eventCode === next.eventCode && item.channel === next.channel;
    return !matchesPrevious && !matchesNext;
  });
  return [...withoutEdited, next];
}

/** Renders editable persisted Notification preferences with TanStack Form/Zod validation. */
function NotificationPreferencesContent() {
  const preferences = useNotificationPreferencesQuery();
  const update = useUpdateNotificationPreferencesMutation();
  const [selected, setSelected] = useState<NotificationPreference | undefined>();

  if (preferences.isPending) return <LoadingState label="Loading notification preferences..." />;
  if (preferences.isError) {
    return (
      <ErrorState
        title="Notification preferences could not be loaded"
        message={preferences.error instanceof Error ? preferences.error.message : "Please try again."}
        requestId={preferences.error instanceof ApiClientError ? preferences.error.requestId : undefined}
        onRetry={() => void preferences.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notifications</p>
        <h1 className="mt-1 text-2xl font-bold">Notification preferences</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Add or update an event/channel preference. Mandatory security or transactional channels remain enforced by the API.
        </p>
      </section>

      {preferences.data.length === 0 ? (
        <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
          No editable preferences have been saved yet. Add one below using a supported domain event code.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {preferences.data.map((preference) => (
            <article key={`${preference.eventCode}:${preference.channel}`} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{preference.eventCode}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {NOTIFICATION_CHANNEL_LABEL[preference.channel]} · {preference.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setSelected(preference)}>
                  Edit
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <NotificationPreferenceForm
        key={selected ? `${selected.eventCode}:${selected.channel}:${selected.enabled}` : "new-preference"}
        initialValue={selected}
        isPending={update.isPending}
        error={update.error}
        onSave={async (next) => {
          await update.mutateAsync({
            preferences: mergePreference(preferences.data, next, selected),
          });
          setSelected(undefined);
        }}
      />
    </div>
  );
}

/** Protects preference management with the server-provided own-preferences permission. */
export function NotificationPreferencesPage() {
  return (
    <CustomerAccountLayout>
      {(user) => user.permissions.includes(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN) ? (
        <NotificationPreferencesContent />
      ) : (
        <ErrorState title="Access denied" message="Your account cannot manage notification preferences." />
      )}
    </CustomerAccountLayout>
  );
}
