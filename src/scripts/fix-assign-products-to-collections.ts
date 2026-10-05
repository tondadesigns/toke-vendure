import "dotenv/config";

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  "https://toke-vendure-production.up.railway.app/admin-api";

const USER = process.env.SUPERADMIN_USERNAME || "";
const PASS = process.env.SUPERADMIN_PASSWORD || "";

let cookie = "";
let authToken = "";

type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

function extractCookieHeader(res: Response): string {
  const headersAny = res.headers as Headers & {
    getSetCookie?: () => string[];
  };

  let rawCookies: string[] = [];

  if (typeof headersAny.getSetCookie === "function") {
    rawCookies = headersAny.getSetCookie();
  } else {
    const single = res.headers.get("set-cookie");
    if (single) {
      rawCookies = single.split(/,(?=[^;]+=[^;]+)/g);
    }
  }

  return rawCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(ADMIN_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(cookie ? { cookie } : {}),
      ...(authToken ? { "vendure-auth-token": authToken } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const freshCookie = extractCookieHeader(res);
  if (freshCookie) cookie = freshCookie;

  const freshAuthToken = res.headers.get("vendure-auth-token");
  if (freshAuthToken) authToken = freshAuthToken;

  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors));
  }
  if (!json.data) {
    throw new Error("No data returned from GraphQL");
  }
  return json.data;
}

async function login() {
  const data = await gql<{
    login: { id: string; identifier: string };
  }>(
    `
      mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password) {
          ... on CurrentUser {
            id
            identifier
          }
        }
      }
    `,
    { username: USER, password: PASS }
  );

  console.log("Login successful:", data.login.identifier);
}

function matchCollection(name: string) {
  if (
    name.includes("Soupe") ||
    name.includes("Salade") ||
    name.includes("Edamame") ||
    name.includes("Gyoza") ||
    name.includes("Tempura crevettes") ||
    name.includes("Tempura légumes")
  ) {
    return "entrees";
  }

  if (
    name.includes("Sushi ") ||
    name.includes("Sashimi") ||
    name.includes("Mix sushi") ||
    name.includes("Mix sashimi")
  ) {
    return "sushi-sashimi";
  }

  if (
    name.includes("California roll") ||
    name.includes("Spicy tuna roll") ||
    name.includes("Salmon avocado roll") ||
    name.includes("Philadelphia roll") ||
    name.includes("Dragon roll") ||
    name.includes("Veggie roll")
  ) {
    return "maki-rolls";
  }

  if (
    name.includes("Menu Lunch") ||
    name.includes("Menu Duo") ||
    name.includes("Menu Family") ||
    name.includes("Box Premium")
  ) {
    return "plateaux";
  }

  if (
    name.includes("Mochi") ||
    name.includes("Tempura banane") ||
    name.includes("Cheesecake") ||
    name === "Glace"
  ) {
    return "desserts";
  }

  if (
    name.includes("Eau") ||
    name.includes("Soda") ||
    name === "Jus" ||
    name.includes("Thé")
  ) {
    return "boissons";
  }

  if (
    name.includes("teriyaki") ||
    name.includes("Yakisoba") ||
    name.includes("Riz sauté") ||
    name.includes("Bento")
  ) {
    return "plateaux";
  }

  return "plateaux";
}

async function main() {
  await login();

  const cols = await gql<{
    collections: { items: Array<{ id: string; slug: string; name: string }> };
  }>(`
    query {
      collections(options: { take: 100 }) {
        items {
          id
          slug
          name
        }
      }
    }
  `);

  const collections = cols.collections.items;
  console.log(
    "Collections found:",
    collections.map((c) => `${c.slug}(${c.id})`).join(", ")
  );

  const prods = await gql<{
    products: { items: Array<{ id: string; name: string }> };
  }>(`
    query {
      products(options: { take: 200 }) {
        items {
          id
          name
        }
      }
    }
  `);

  const products = prods.products.items;
  console.log("Products found:", products.length);

  for (const p of products) {
    const targetSlug = matchCollection(p.name);
    const col = collections.find((c) => c.slug === targetSlug);

    if (!col) {
      console.log(`Skipped (collection missing): ${p.name} -> ${targetSlug}`);
      continue;
    }

    await gql(
      `
        mutation AddProductsToCollection($collectionId: ID!, $productIds: [ID!]!) {
          addProductsToCollection(collectionId: $collectionId, productIds: $productIds) {
            id
          }
        }
      `,
      {
        collectionId: col.id,
        productIds: [p.id],
      }
    );

    console.log(`Assigned: ${p.name} -> ${targetSlug}`);
  }

  console.log("✅ DONE assign");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
