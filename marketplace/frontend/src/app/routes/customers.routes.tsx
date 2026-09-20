import { createRoute } from "@tanstack/react-router";
import { AdminCustomerDetailPage } from "@/features/customers/pages/admin-customer-detail.page";
import { AdminCustomersPage } from "@/features/customers/pages/admin-customers.page";
import { CustomerAddressesPage } from "@/features/customers/pages/customer-addresses.page";
import { CustomerProfilePage } from "@/features/customers/pages/customer-profile.page";
import { rootRoute } from "./root.route";

export const customerProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/customer/profile",
  component: CustomerProfilePage,
});

export const customerAddressesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/customer/addresses",
  component: CustomerAddressesPage,
});

export const adminCustomersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/customers",
  component: AdminCustomersPage,
});

export const adminCustomerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/customers/$customerId",
  component: AdminCustomerDetailPage,
});
