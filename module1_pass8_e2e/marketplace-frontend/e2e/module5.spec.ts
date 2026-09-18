import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";
const apiBase = `${apiOrigin}/api/v1`;
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface AuthUser {
  id: string;
  email: string;
  accountType: "platform_admin" | "seller" | "customer";
  permissions: string[];
}

interface SessionData {
  accessToken: string;
  user: AuthUser;
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

interface SellerApplication {
  id: string;
  status: "submitted" | "approved" | "rejected";
}

interface SellerRecord {
  id: string;
}

interface CategoryTreeNode {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  status: "active" | "inactive";
  children: CategoryTreeNode[];
}

/** Creates one collision-resistant suffix for browser-owned catalog data. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds one bearer header for direct API setup and negative authorization checks. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one identity through the real API. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<SessionData>;
  expect(body.success).toBe(true);
  return body.data;
}

/** Signs in through the real browser UI and verifies the permission-aware destination. */
async function browserLogin(
  page: Page,
  email: string,
  password: string,
  expectedPath: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll("/", "\\/")}$`));
}

/** Registers one customer through the approved public registration endpoint. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(prefix);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 5 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Submits one seller application through the approved Module 4 command. */
async function submitSellerApplication(
  context: APIRequestContext,
  accessToken: string,
  label: string,
): Promise<SellerApplication> {
  const response = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(accessToken),
    data: {
      legalName: `${label} Legal Ltd`,
      displayName: `${label} Seller`,
      taxId: null,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerApplication>).data;
}

/** Approves one seller application through the privileged Module 4 review command. */
async function approveSellerApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<SellerRecord> {
  const response = await context.post(
    `${apiBase}/admin/seller-applications/${applicationId}/approve`,
    {
      headers: bearer(adminToken),
      data: {},
    },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<{
    application: SellerApplication;
    seller: SellerRecord;
  }>;
  return body.data.seller;
}

/** Creates one approved seller owner without manually editing the database. */
async function createApprovedSeller(
  context: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<{ email: string; password: string; accessToken: string; sellerId: string }> {
  const password = "Module5Seller!123";
  const owner = await registerCustomer(context, prefix, password);
  const customerSession = await apiLogin(context, owner.email, password);
  const application = await submitSellerApplication(
    context,
    customerSession.accessToken,
    prefix,
  );
  const seller = await approveSellerApplication(context, adminToken, application.id);
  const sellerSession = await apiLogin(context, owner.email, password);
  return {
    email: owner.email,
    password,
    accessToken: sellerSession.accessToken,
    sellerId: seller.id,
  };
}

/** Creates one category through the real administration page. */
async function createCategoryInBrowser(
  page: Page,
  input: {
    name: string;
    slug: string;
    parentLabel?: string;
    status?: "active" | "inactive";
  },
): Promise<void> {
  await page.getByLabel("Category name").fill(input.name);
  await page.getByLabel("Category slug").fill(input.slug);
  await page
    .getByLabel("Category parent")
    .selectOption(input.parentLabel ? { label: input.parentLabel } : { label: "Root category" });
  await page.getByLabel("Category status").selectOption(input.status ?? "active");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
}

/** Flattens the API category tree so E2E checks can resolve created IDs without database access. */
function flattenCategories(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

/** Loads the administrator-visible category tree through the approved read route. */
async function loadAdminCategories(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryTreeNode[]> {
  const response = await context.get(`${apiBase}/catalog/categories`, {
    headers: bearer(adminToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CategoryTreeNode[]>).data;
}

/** Returns one category created by this E2E suite or fails with a readable message. */
async function categoryBySlug(
  context: APIRequestContext,
  adminToken: string,
  slug: string,
): Promise<CategoryTreeNode> {
  const categories = flattenCategories(await loadAdminCategories(context, adminToken));
  const category = categories.find((item) => item.slug === slug);
  expect(category, `Category ${slug} must exist`).toBeTruthy();
  return category!;
}

/** Creates one brand through the real administration page. */
async function createBrandInBrowser(page: Page, name: string, slug: string): Promise<void> {
  await page.goto("/admin/catalog/brands");
  await page.getByLabel("Brand name").fill(name);
  await page.getByLabel("Brand slug").fill(slug);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Creates one reusable value-backed attribute through the real administration page. */
async function createAttributeInBrowser(
  page: Page,
  input: { name: string; code: string; values: string[]; variantAxis?: boolean },
): Promise<void> {
  await page.goto("/admin/catalog/attributes");
  await page.getByLabel("Attribute name").fill(input.name);
  await page.getByLabel("Attribute code").fill(input.code);
  await page.getByLabel("Attribute data type").fill("option");
  await page.getByLabel("Attribute values").fill(input.values.join("\n"));
  if (input.variantAxis) await page.getByLabel("Variant axis").check();
  await page.getByRole("button", { name: "Create attribute" }).click();
  await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
}

test.describe("Module 5 Catalog Taxonomy E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  const suffix = unique("catalog");
  const electronicsName = `Electronics ${suffix}`;
  const electronicsSlug = `electronics-${suffix}`;
  const phonesName = `Phones ${suffix}`;
  const phonesSlug = `phones-${suffix}`;
  const smartphonesName = `Smartphones ${suffix}`;
  const smartphonesSlug = `smartphones-${suffix}`;
  const inactiveName = `Archived ${suffix}`;
  const inactiveSlug = `archived-${suffix}`;
  const brandName = `Acme ${suffix}`;
  const brandSlug = `acme-${suffix}`;
  const sizeName = `Size ${suffix}`;
  const sizeCode = `size-${suffix}`;
  const colorName = `Color ${suffix}`;
  const colorCode = `color-${suffix}`;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("builds a hierarchy in the browser and protects category cycles", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/admin/catalog/categories");
    await expect(page.getByRole("heading", { name: "Category tree editor" })).toBeVisible();

    await createCategoryInBrowser(page, {
      name: electronicsName,
      slug: electronicsSlug,
    });
    await createCategoryInBrowser(page, {
      name: phonesName,
      slug: phonesSlug,
      parentLabel: electronicsName,
    });
    await createCategoryInBrowser(page, {
      name: smartphonesName,
      slug: smartphonesSlug,
      parentLabel: `— ${phonesName}`,
    });
    await createCategoryInBrowser(page, {
      name: inactiveName,
      slug: inactiveSlug,
      status: "inactive",
    });

    const electronics = await categoryBySlug(apiContext, adminToken, electronicsSlug);
    const smartphones = await categoryBySlug(apiContext, adminToken, smartphonesSlug);

    const electronicsHeading = page.getByRole("heading", {
      name: electronicsName,
      exact: true,
    });
    const electronicsCard = electronicsHeading.locator(
      "xpath=ancestor::div[.//button[normalize-space()='Edit category']][1]",
    );
    await electronicsCard.getByRole("button", { name: "Edit category" }).click();
    const parentSelect = page.getByLabel(`Category parent ${electronics.id}`);
    await expect(parentSelect.locator(`option[value='${smartphones.id}']`)).toHaveCount(0);

    const cycle = await apiContext.patch(
      `${apiBase}/admin/catalog/categories/${electronics.id}`,
      {
        headers: bearer(adminToken),
        data: { parentId: smartphones.id },
      },
    );
    expect(cycle.status()).toBe(409);
    const cycleBody = (await cycle.json()) as ApiEnvelope<unknown>;
    expect(cycleBody.error?.code).toBe("CATEGORY_CYCLE");

    const publicTreeResponse = await apiContext.get(`${apiBase}/catalog/categories`);
    expect(publicTreeResponse.status()).toBe(200);
    const publicTree = (await publicTreeResponse.json()) as ApiEnvelope<CategoryTreeNode[]>;
    expect(flattenCategories(publicTree.data).some((item) => item.slug === inactiveSlug)).toBe(false);
  });

  test("creates brands, attributes, and a complete category mapping through the browser", async ({
    page,
  }) => {
    await browserLogin(page, adminEmail, adminPassword, "/admin/users");

    await createBrandInBrowser(page, brandName, brandSlug);
    await createAttributeInBrowser(page, {
      name: sizeName,
      code: sizeCode,
      values: ["Small", "Medium", "Large"],
      variantAxis: true,
    });
    await createAttributeInBrowser(page, {
      name: colorName,
      code: colorCode,
      values: ["Black", "White"],
    });

    await page.goto("/admin/catalog/category-attributes");
    await expect(
      page.getByRole("heading", { name: "Category-to-attribute mapping" }),
    ).toBeVisible();
    await page.getByLabel("Mapping category").selectOption({ label: electronicsName });
    await page.getByLabel(`Map attribute ${sizeName}`).check();
    await page.getByLabel(`Required ${sizeName}`).check();
    await page.getByLabel(`Filterable ${sizeName}`).check();
    await page.getByLabel(`Map attribute ${colorName}`).check();
    await page.getByLabel(`Filterable ${colorName}`).check();
    await page.getByLabel("Confirm complete mapping replacement").check();
    await page.getByRole("button", { name: "Replace category mapping" }).click();

    await expect(page.getByRole("heading", { name: "Last accepted replacement" })).toBeVisible();
    await expect(page.getByText("Server returned 2 mapped attributes.")).toBeVisible();
  });

  test("gives an approved seller read-only taxonomy while blocking catalog mutation", async ({
    page,
  }) => {
    const seller = await createApprovedSeller(apiContext, adminToken, `module5-${suffix}`);
    await browserLogin(page, seller.email, seller.password, "/seller/profile");
    await page.goto("/seller/catalog-taxonomy");

    await expect(page.getByRole("heading", { name: "Seller taxonomy selector" })).toBeVisible();
    await page.getByLabel("Taxonomy category selector").selectOption({ label: electronicsName });
    await page.getByLabel("Taxonomy brand selector").selectOption({ label: brandName });
    await page.getByLabel(`Select taxonomy attribute ${sizeName}`).check();
    await page.getByLabel(`Select taxonomy attribute ${colorName}`).check();
    await expect(page.getByRole("button", { name: "Create category" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create brand" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create attribute" })).toHaveCount(0);

    const forbidden = await apiContext.post(`${apiBase}/admin/catalog/categories`, {
      headers: bearer(seller.accessToken),
      data: { slug: `forbidden-${suffix}`, name: `Forbidden ${suffix}` },
    });
    expect(forbidden.status()).toBe(403);
  });

  test("shows a clear permission state to a normal customer on admin taxonomy routes", async ({
    page,
  }) => {
    const password = "Module5Customer!123";
    const customer = await registerCustomer(apiContext, "module5-customer", password);
    await browserLogin(page, customer.email, password, "/documents");
    await page.goto("/admin/catalog/categories");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(
      page.getByText("Your account does not have permission to use this catalog taxonomy feature."),
    ).toBeVisible();
  });
});
