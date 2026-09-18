import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { getPostLoginPath } from "@/features/auth/auth.navigation";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const userId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const childCategoryId = "33333333-3333-4333-8333-333333333333";
const brandId = "44444444-4444-4444-8444-444444444444";
const attributeId = "55555555-5555-4555-8555-555555555555";
const valueId = "66666666-6666-4666-8666-666666666666";
const secondAttributeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Creates one deterministic actor for Module 5 frontend tests. */
function actor(
  accountType: "platform_admin" | "seller" | "customer",
  permissions: string[],
): AuthenticatedUser {
  return {
    id: userId,
    email: `${accountType}@example.com`,
    displayName: accountType === "platform_admin" ? "Catalog Admin" : "Marketplace User",
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: {
      sellerIds: accountType === "seller" ? ["77777777-7777-4777-8777-777777777777"] : [],
      storeIds: [],
    },
  };
}

/** Registers the current authenticated actor returned by /auth/me. */
function useActor(
  accountType: "platform_admin" | "seller" | "customer",
  permissions: string[],
): void {
  setAccessToken("module5-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: actor(accountType, permissions) }),
    ),
  );
}

/** Returns one deterministic category tree used by Module 5 UI tests. */
function categoryTree() {
  return [
    {
      id: categoryId,
      parentId: null,
      slug: "electronics",
      name: "Electronics",
      status: "active",
      sortOrder: 0,
      children: [
        {
          id: childCategoryId,
          parentId: categoryId,
          slug: "phones",
          name: "Phones",
          status: "active",
          sortOrder: 0,
          children: [],
        },
      ],
    },
  ];
}

/** Returns one deterministic active brand. */
function brand() {
  return { id: brandId, slug: "acme", name: "Acme", status: "active" };
}

/** Returns one deterministic attribute definition with an allowed value. */
function attribute() {
  return {
    id: attributeId,
    code: "size",
    name: "Size",
    dataType: "option",
    isVariantAxis: true,
    status: "active",
    values: [
      {
        id: valueId,
        attributeId,
        value: "Small",
        sortOrder: 0,
        status: "active",
      },
    ],
  };
}

/** Returns a second active attribute used to prove category-scoped seller filtering. */
function secondAttribute() {
  return {
    id: secondAttributeId,
    code: "material",
    name: "Material",
    dataType: "text",
    isVariantAxis: false,
    status: "active",
    values: [],
  };
}

/** Renders one application route with a fresh TanStack Query cache. */
async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 5 Catalog Taxonomy UI", () => {
  it("routes a catalog-only administrator to the category editor after login", () => {
    expect(getPostLoginPath(actor("platform_admin", ["catalog.manage_categories"]))).toBe(
      "/admin/catalog/categories",
    );
  });

  it("creates a normalized category and refreshes the hierarchy", async () => {
    useActor("platform_admin", ["catalog.manage_categories"]);
    let categories = categoryTree();
    let createBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/categories`, () =>
        HttpResponse.json({ success: true, data: categories }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/catalog/categories`, async ({ request }) => {
        createBody = await request.json();
        const created = {
          id: "88888888-8888-4888-8888-888888888888",
          parentId: categoryId,
          slug: "laptops",
          name: "Laptops",
          status: "active",
          sortOrder: 2,
        };
        categories = [
          {
            ...categories[0]!,
            children: [...categories[0]!.children, { ...created, children: [] }],
          },
        ];
        return HttpResponse.json({ success: true, data: created }, { status: 201 });
      }),
    );

    await renderRoute("/admin/catalog/categories");
    await screen.findByText("Electronics");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Category name"), "Laptops");
    await user.type(screen.getByLabelText("Category slug"), "Laptops");
    await user.selectOptions(screen.getByLabelText("Category parent"), categoryId);
    await user.clear(screen.getByLabelText("Category sort order"));
    await user.type(screen.getByLabelText("Category sort order"), "2");
    await user.click(screen.getByRole("button", { name: "Create category" }));

    expect(await screen.findByText("Laptops")).toBeInTheDocument();
    expect(createBody).toEqual({
      parentId: categoryId,
      slug: "laptops",
      name: "Laptops",
      status: "active",
      sortOrder: 2,
    });
  });

  it("creates a brand through the approved create command", async () => {
    useActor("platform_admin", ["catalog.manage_brands"]);
    let brands = [brand()];
    let requestBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/brands`, () =>
        HttpResponse.json({ success: true, data: brands }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/catalog/brands`, async ({ request }) => {
        requestBody = await request.json();
        const created = {
          id: "99999999-9999-4999-8999-999999999999",
          slug: "north-star",
          name: "North Star",
          status: "active",
        };
        brands = [...brands, created];
        return HttpResponse.json({ success: true, data: created }, { status: 201 });
      }),
    );

    await renderRoute("/admin/catalog/brands");
    await screen.findByText("Acme");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Brand name"), "North Star");
    await user.type(screen.getByLabelText("Brand slug"), "North Star");
    await user.click(screen.getByRole("button", { name: "Create brand" }));

    expect(await screen.findByText("North Star")).toBeInTheDocument();
    expect(requestBody).toEqual({ slug: "north star", name: "North Star", status: "active" });
  });

  it("creates a value-backed variant-axis attribute", async () => {
    useActor("platform_admin", ["catalog.manage_attributes"]);
    let attributes = [attribute()];
    let requestBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/attributes`, () =>
        HttpResponse.json({ success: true, data: attributes }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/catalog/attributes`, async ({ request }) => {
        requestBody = await request.json();
        const created = {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          code: "color",
          name: "Color",
          dataType: "option",
          isVariantAxis: true,
          status: "active",
          values: [],
        };
        attributes = [...attributes, created];
        return HttpResponse.json({ success: true, data: created }, { status: 201 });
      }),
    );

    await renderRoute("/admin/catalog/attributes");
    await screen.findByText("Size");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Attribute name"), "Color");
    await user.type(screen.getByLabelText("Attribute code"), "COLOR");
    await user.type(screen.getByLabelText("Attribute data type"), "OPTION");
    await user.type(screen.getByLabelText("Attribute values"), "Red\nBlue");
    await user.click(screen.getByLabelText("Variant axis"));
    await user.click(screen.getByRole("button", { name: "Create attribute" }));

    await waitFor(() => expect(requestBody).toBeDefined());
    expect(requestBody).toEqual({
      code: "color",
      name: "Color",
      dataType: "option",
      isVariantAxis: true,
      status: "active",
      values: [
        { value: "Red", sortOrder: 0, status: "active" },
        { value: "Blue", sortOrder: 1, status: "active" },
      ],
    });
  });

  it("shows the variant-axis data-type rule before sending an invalid attribute", async () => {
    useActor("platform_admin", ["catalog.manage_attributes"]);
    let requestBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/attributes`, () =>
        HttpResponse.json({ success: true, data: [attribute()] }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/catalog/attributes`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ success: true, data: attribute() }, { status: 201 });
      }),
    );

    await renderRoute("/admin/catalog/attributes");
    await screen.findByText("Size");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Attribute name"), "Color");
    await user.type(screen.getByLabelText("Attribute code"), "color");
    await user.type(screen.getByLabelText("Attribute data type"), "text");
    await user.type(screen.getByLabelText("Attribute values"), "Red\nBlue");
    await user.click(screen.getByLabelText("Variant axis"));
    await user.click(screen.getByRole("button", { name: "Create attribute" }));

    expect(await screen.findByText('Variant-axis attributes use the "option" data type.')).toBeInTheDocument();
    expect(requestBody).toBeUndefined();
  });

  it("loads the current mapping before requiring deliberate replacement confirmation", async () => {
    useActor("platform_admin", ["catalog.manage_categories", "catalog.manage_attributes"]);
    let requestBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/categories`, () =>
        HttpResponse.json({ success: true, data: categoryTree() }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/catalog/attributes`, () =>
        HttpResponse.json({ success: true, data: [attribute()] }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/catalog/categories/${categoryId}/attributes`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              categoryId,
              attributeId,
              isRequired: true,
              isFilterable: true,
              sortOrder: 3,
            },
          ],
        }),
      ),
      http.put(
        `${env.VITE_API_BASE_URL}/admin/catalog/categories/${categoryId}/attributes`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            success: true,
            data: [
              {
                categoryId,
                attributeId,
                isRequired: true,
                isFilterable: true,
                sortOrder: 4,
              },
            ],
          });
        },
      ),
    );

    await renderRoute("/admin/catalog/category-attributes");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Mapping category"), categoryId);

    await waitFor(() => expect(screen.getByLabelText("Map attribute Size")).toBeChecked());
    expect(screen.getByLabelText("Required Size")).toBeChecked();
    expect(screen.getByLabelText("Filterable Size")).toBeChecked();
    expect(screen.getByLabelText("Mapping sort order Size")).toHaveValue(3);

    await user.clear(screen.getByLabelText("Mapping sort order Size"));
    await user.type(screen.getByLabelText("Mapping sort order Size"), "4");
    await user.click(screen.getByRole("button", { name: "Replace category mapping" }));
    expect(requestBody).toBeUndefined();

    await user.click(screen.getByLabelText("Confirm complete mapping replacement"));
    await user.click(screen.getByRole("button", { name: "Replace category mapping" }));

    await waitFor(() => expect(requestBody).toBeDefined());
    expect(requestBody).toEqual({
      attributes: [
        {
          attributeId,
          isRequired: true,
          isFilterable: true,
          sortOrder: 4,
        },
      ],
    });
    expect(await screen.findByText("Server returned 1 mapped attribute.")).toBeInTheDocument();
  });

  it("gives sellers only the attributes mapped to their selected category", async () => {
    useActor("seller", ["catalog.read"]);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/catalog/categories`, () =>
        HttpResponse.json({ success: true, data: categoryTree() }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/catalog/brands`, () =>
        HttpResponse.json({ success: true, data: [brand()] }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/catalog/attributes`, () =>
        HttpResponse.json({ success: true, data: [attribute(), secondAttribute()] }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/catalog/categories/${categoryId}/attributes`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              categoryId,
              attributeId,
              isRequired: true,
              isFilterable: true,
              sortOrder: 0,
            },
          ],
        }),
      ),
    );

    await renderRoute("/seller/catalog-taxonomy");
    expect(await screen.findByRole("heading", { name: "Seller taxonomy selector" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("Choose a category to see its allowed attributes.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Taxonomy category selector"), categoryId);

    expect(await screen.findByText("Size")).toBeInTheDocument();
    expect(screen.getByText(/required/)).toBeInTheDocument();
    expect(screen.queryByText("Material")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create brand" })).not.toBeInTheDocument();
  });

  it("renders a clear permission state instead of exposing the category editor", async () => {
    useActor("customer", ["catalog.read"]);
    await renderRoute("/admin/catalog/categories");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create category" })).not.toBeInTheDocument();
  });
});
