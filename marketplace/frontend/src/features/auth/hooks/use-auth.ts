import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser,
  login,
  logout,
  registerCustomer,
} from "../api/auth.api";
import { authQueryKeys } from "./auth.query-keys";

/** Loads the current authenticated actor without retrying permission/session failures. */
export function useCurrentUserQuery() {
  return useQuery({
    queryKey: authQueryKeys.me,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 30_000,
  });
}

/** Creates a public customer account. */
export function useRegisterMutation() {
  return useMutation({ mutationFn: registerCustomer });
}

/** Logs in and primes the current-user query with the returned server actor. */
export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) => queryClient.setQueryData(authQueryKeys.me, session.user),
  });
}

/** Logs out the current session and removes cached authentication state. */
export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.removeQueries({ queryKey: authQueryKeys.all }),
  });
}
