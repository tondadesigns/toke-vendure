import "dotenv/config";

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  "https://toke-vendure-production.up.railway.app/admin-api";

const USER = process.env.SUPERADMIN_USERNAME || "";
const PASS = process.env.SUPERADMIN_PASSWORD || "";

let cookie = "";
let authToken = "";

async function gql(query: string, variables: any = {}) {
  const res = await fetch(ADMIN_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(authToken ? { "vendure-auth-token": authToken } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie;

  const token = res.headers.get("vendure-auth-token");
  if (token) authToken = token;

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function main() {
  await gql(
    `
      mutation Login($u: String!, $p: String!) {
        login(username: $u, password: $p) {
          ... on CurrentUser { id identifier }
        }
      }
    `,
    { u: USER, p: PASS }
  );

  console.log("Login OK");

  const data = await gql(`
    query {
      collections(options: { take: 100 }) {
        items { id name slug }
      }
      facetValues(options: { take: 100 }) {
        items { id name code }
      }
    }
  `);

  const collections = data.collections.items;
  const facetValues = data.facetValues.items;

  const targets = [
    "entrees",
    "sushi-sashimi",
    "maki-rolls",
    "plateaux",
    "desserts",
    "boissons",
  ];

  for (const slug of targets) {
    const collection = collections.find((c: any) => c.slug === slug);
    const facetValue = facetValues.find(
      (f: any) => f.code === slug || f.name === slug
    );

    if (!collection) {
      console.log(`Missing collection: ${slug}`);
      continue;
    }

    if (!facetValue) {
      console.log(`Missing facet value: ${slug}`);
      continue;
    }

    await gql(
      `
        mutation UpdateCollection($input: UpdateCollectionInput!) {
          updateCollection(input: $input) {
            id
            name
            slug
          }
        }
      `,
      {
        input: {
          id: collection.id,
          filters: [
            {
              code: "facet-value-filter",
              arguments: [
                {
                  name: "facetValueIds",
                  value: JSON.stringify([facetValue.id]),
                },
                {
                  name: "containsAny",
                  value: "true",
                },
              ],
            },
          ],
        },
      }
    );

    console.log(`Updated filter: ${slug} -> facetValue ${facetValue.id}`);
  }

  console.log("✅ DONE filters");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
