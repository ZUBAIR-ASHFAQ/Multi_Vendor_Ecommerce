import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "../api/notifications.api";
import type {
  AdminNotificationDeliveryListParams,
  NotificationListParams,
  UpdateNotificationPreferencesInput,
} from "../types/notifications.types";
import { notificationsQueryKeys } from "./notifications.query-keys";

/** Loads one page of owned Notifications; the optional flag prevents unauthorized background requests. */
export function useNotificationsQuery(params: NotificationListParams, enabled = true) {
  return useQuery({
    queryKey: notificationsQueryKeys.list(params),
    queryFn: () => notificationsApi.listNotifications(params),
    enabled,
    retry: false,
  });
}

/** Loads the authenticated user's editable Notification preferences. */
export function useNotificationPreferencesQuery() {
  return useQuery({
    queryKey: notificationsQueryKeys.preferences,
    queryFn: notificationsApi.getPreferences,
    retry: false,
  });
}

/** Marks one Notification read and refreshes every owned Notification projection, including the bell count. */
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: notificationsQueryKeys.all }),
  });
}

/** Marks every owned Notification read and refreshes the list/unread count. */
export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: notificationsQueryKeys.all }),
  });
}

/** Replaces editable preferences and refreshes their canonical server representation. */
export function useUpdateNotificationPreferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      notificationsApi.updatePreferences(input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: notificationsQueryKeys.preferences }),
  });
}

/** Loads one page of failed Notification deliveries for an authorized administrator. */
export function useAdminNotificationDeliveriesQuery(
  params: AdminNotificationDeliveryListParams,
) {
  return useQuery({
    queryKey: notificationsQueryKeys.adminDeliveries(params),
    queryFn: () => notificationsApi.listFailedDeliveries(params),
    retry: false,
  });
}

/** Requeues one failed delivery and refreshes the failure queue after the command succeeds. */
export function useRetryNotificationDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.retryFailedDelivery,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: notificationsQueryKeys.all }),
  });
}
