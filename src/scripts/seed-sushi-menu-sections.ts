import 'dotenv/config';

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  'https://toke-vendure-production.up.railway.app/admin-api';

const SUPERADMIN_USERNAME =
  process.env.SUPERADMIN_USERNAME ||
  process.env.VENDURE_ADMIN_USER ||
  '';

const SUPERADMIN_PASSWORD =
  process.env.SUPERADMIN_PASSWORD ||
  process.env.VENDURE_ADMIN_PASS ||
  '';

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

type Channel = { id: string; code: string; token?: string };
type FacetValueLite = { id: string; name: string; code: string };

let sessionCookie = '';

function extractCookieHeader(res: Response): string {
  const headersAny = res.headers as Headers & {
    getSetCookie?: () => string[];
  };

  let rawCookies: string[] = [];

  if (typeof headersAny.getSetCookie === 'function') {
    rawCookies = headersAny.getSetCookie();
  } else {
    const single = res.headers.get('set-cookie');
    if (single) {
      rawCookies = single.split(/,(?=[^;]+=[^;]+)/g);
    }
  }

  return rawCookies
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const cookieHeader = extractCookieHeader(res);
  if (cookieHeader) {
    sessionCookie = cookieHeader;
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(' | '));
  }

  if (!json.data) {
    throw new Error('No data returned from GraphQL API');
  }

  return json.data;
}

async function gqlSafe<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    return await gql<T>(query, variables);
  } catch (err: any) {
    console.warn('GraphQL warning:', err?.message || String(err));
    return null;
  }
}

async function login(): Promise<void> {
  const data = await gql<{
    login: {
      __typename: string;
      id?: string;
      identifier?: string;
      errorCode?: string;
      message?: string;
    };
  }>(
    `
      mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: true) {
          __typename
          ... on CurrentUser {
            id
            identifier
          }
          ... on ErrorResult {
            errorCode
            message
          }
        }
      }
    `,
    {
      username: SUPERADMIN_USERNAME,
      password: SUPERADMIN_PASSWORD,
    }
  );

  const result = data.login;

  if (result.__typename === 'CurrentUser') {
    if (!sessionCookie) {
      throw new Error('Login succeeded but no session cookie was returned');
    }
    return;
  }

  throw new Error(
    `Login failed: ${result.message || result.errorCode || result.__typename}`
  );
}

async function getChannelsSafe(): Promise<Channel[]> {
  const data = await gqlSafe<{
    channels: { items: Channel[] };
  }>(`
    query {
      channels {
        items {
          id
          code
          token
        }
      }
    }
  `);

  return data?.channels?.items || [];
}

async function getCollectionBySlug(slug: string) {
  const data = await gql<{
    collections: { items: Array<{ id: string; name: string; slug: string }> };
  }>(
    `
      query GetCollections($options: CollectionListOptions) {
        collections(options: $options) {
          items {
            id
            name
            slug
          }
        }
      }
    `,
    {
      options: {
        take: 50,
        filter: {
          slug: { eq: slug },
        },
      },
    }
  );

  return data.collections.items[0];
}

async function getCollectionDetail(id: string) {
  return gql<{
    collection: {
      id: string;
      slug: string;
      name: string;
      isPrivate: boolean;
      parent?: { id: string } | null;
      inheritFilters: boolean;
      translations: Array<{
        id?: string;
        languageCode: string;
        name: string;
        slug: string;
        description?: string | null;
      }>;
    };
  }>(
    `
      query GetCollection($id: ID!) {
        collection(id: $id) {
          id
          slug
          name
          isPrivate
          inheritFilters
          parent { id }
          translations {
            id
            languageCode
            name
            slug
            description
          }
        }
      }
    `,
    { id }
  );
}

async function updateCollectionFacetFilter(
  collectionId: string,
  facetValueId: string
) {
  const detail = await getCollectionDetail(collectionId);
  const c = detail.collection;

  return gql<{
    updateCollection: { id: string; name: string; slug: string };
  }>(
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
        id: collectionId,
        isPrivate: c.isPrivate,
        parentId: c.parent?.id,
        inheritFilters: false,
        translations: c.translations.map((t) => ({
          id: t.id,
          languageCode: t.languageCode,
          name: t.name,
          slug: t.slug,
          description: t.description || '',
        })),
        filters: [
          {
            code: 'facet-value-filter',
            arguments: [
              {
                name: 'facetValueIds',
                value: JSON.stringify([facetValueId]),
              },
            ],
          },
        ],
      },
    }
  );
}

async function getFacets() {
  return gql<{
    facets: {
      items: Array<{
        id: string;
        code: string;
        name: string;
        values: FacetValueLite[];
      }>;
    };
  }>(`
    query {
      facets(options: { take: 100 }) {
        items {
          id
          code
          name
          values {
            id
            name
            code
          }
        }
      }
    }
  `);
}

async function getFacetByCode(code: string) {
  const data = await getFacets();
  return data.facets.items.find((f) => f.code === code);
}

async function createFacetWithValues(
  code: string,
  name: string,
  values: Array<{ code: string; name: string }>
) {
  return gql<{
    createFacet: {
      id: string;
      code: string;
      name: string;
      values: FacetValueLite[];
    };
  }>(
    `
      mutation CreateFacet($input: CreateFacetInput!) {
        createFacet(input: $input) {
          id
          code
          name
          values {
            id
            name
            code
          }
        }
      }
    `,
    {
      input: {
        code,
        isPrivate: false,
        translations: [
          {
            languageCode: 'en',
            name,
          },
        ],
        values: values.map((v) => ({
          code: v.code,
          translations: [
            {
              languageCode: 'en',
              name: v.name,
            },
          ],
        })),
      },
    }
  );
}

async function createFacetValues(
  facetId: string,
  values: Array<{ code: string; name: string }>
) {
  return gql<{
    createFacetValues: FacetValueLite[];
  }>(
    `
      mutation CreateFacetValues($input: [CreateFacetValueInput!]!) {
        createFacetValues(input: $input) {
          id
          name
          code
        }
      }
    `,
    {
      input: values.map((v) => ({
        facetId,
        code: v.code,
        translations: [
          {
            languageCode: 'en',
            name: v.name,
          },
        ],
      })),
    }
  );
}

async function assignFacetsToChannelSafe(facetIds: string[], channelId?: string) {
  if (!channelId) {
    console.log('No channel assignment. Continuing with default channel.');
    return;
  }

  const result = await gqlSafe<{
    assignFacetsToChannel: Array<{ id: string; code: string; name: string }>;
  }>(
    `
      mutation AssignFacetsToChannel($input: AssignFacetsToChannelInput!) {
        assignFacetsToChannel(input: $input) {
          id
          code
          name
        }
      }
    `,
    {
      input: {
        facetIds,
        channelId,
      },
    }
  );

  if (result) {
    console.log('Facet assigned to channel');
  } else {
    console.log('Facet channel assignment skipped');
  }
}

async function searchProductsByName(term: string) {
  return gql<{
    products: {
      items: Array<{ id: string; name: string; slug: string }>;
    };
  }>(
    `
      query SearchProducts($options: ProductListOptions) {
        products(options: $options) {
          items {
            id
            name
            slug
          }
        }
      }
    `,
    {
      options: {
        take: 20,
        filter: {
          name: { contains: term },
        },
      },
    }
  );
}

async function getProductDetail(productId: string) {
  return gql<{
    product: {
      id: string;
      name: string;
      enabled: boolean;
      translations: Array<{
        languageCode: string;
        name: string;
        slug: string;
        description?: string | null;
      }>;
      facetValues: Array<{
        id: string;
        code: string;
        name: string;
        facet: { id: string; code: string; name: string };
      }>;
    };
  }>(
    `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          name
          enabled
          translations {
            languageCode
            name
            slug
            description
          }
          facetValues {
            id
            code
            name
            facet {
              id
              code
              name
            }
          }
        }
      }
    `,
    { id: productId }
  );
}

async function updateProductFacetValues(
  productId: string,
  facetValueIds: string[]
) {
  const detail = await getProductDetail(productId);
  const p = detail.product;

  return gql<{
    updateProduct: { id: string; name: string; slug: string };
  }>(
    `
      mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
          id
          name
          slug
        }
      }
    `,
    {
      input: {
        id: productId,
        enabled: p.enabled,
        facetValueIds,
        translations: p.translations.map((t) => ({
          languageCode: t.languageCode,
          name: t.name,
          slug: t.slug,
          description: t.description || '',
        })),
      },
    }
  );
}

async function runPendingSearchIndexUpdates() {
  return gqlSafe<{
    runPendingSearchIndexUpdates: { success: boolean };
  }>(`
    mutation {
      runPendingSearchIndexUpdates {
        success
      }
    }
  `);
}

type ProductSeedRow = {
  name: string;
  sectionSlug: string;
};

const PRODUCTS: ProductSeedRow[] = [
  { name: 'Soupe miso', sectionSlug: 'entrees' },
  { name: 'Salade wakame', sectionSlug: 'entrees' },
  { name: 'Edamame', sectionSlug: 'entrees' },
  { name: 'Edamame épicé', sectionSlug: 'entrees' },
  { name: 'Gyoza (5 pcs)', sectionSlug: 'entrees' },
  { name: 'Tempura crevettes (4 pcs)', sectionSlug: 'entrees' },
  { name: 'Tempura légumes', sectionSlug: 'entrees' },

  { name: 'Sushi saumon (2 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Sushi thon (2 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Sushi crevette (2 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Sashimi saumon (6 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Sashimi thon (6 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Mix sushi (8 pcs)', sectionSlug: 'sushi-sashimi' },
  { name: 'Mix sashimi (10 pcs)', sectionSlug: 'sushi-sashimi' },

  { name: 'California roll', sectionSlug: 'maki-rolls' },
  { name: 'Spicy tuna roll', sectionSlug: 'maki-rolls' },
  { name: 'Salmon avocado roll', sectionSlug: 'maki-rolls' },
  { name: 'Philadelphia roll', sectionSlug: 'maki-rolls' },
  { name: 'Dragon roll', sectionSlug: 'maki-rolls' },
  { name: 'Veggie roll', sectionSlug: 'maki-rolls' },

  { name: 'Poulet teriyaki + riz', sectionSlug: 'plats-chauds' },
  { name: 'Saumon teriyaki + riz', sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba poulet', sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba crevettes', sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba légumes', sectionSlug: 'plats-chauds' },
  { name: 'Riz sauté', sectionSlug: 'plats-chauds' },
  { name: 'Bento box', sectionSlug: 'plats-chauds' },

  { name: 'Menu Lunch (12 pcs + boisson)', sectionSlug: 'formules' },
  { name: 'Menu Duo (24 pcs)', sectionSlug: 'formules' },
  { name: 'Menu Family (48 pcs)', sectionSlug: 'formules' },
  { name: 'Box Premium', sectionSlug: 'formules' },

  { name: 'Mochi glacé (2 pcs)', sectionSlug: 'desserts' },
  { name: 'Tempura banane', sectionSlug: 'desserts' },
  { name: 'Cheesecake japonais', sectionSlug: 'desserts' },
  { name: 'Glace', sectionSlug: 'desserts' },

  { name: 'Eau minérale', sectionSlug: 'boissons' },
  { name: 'Soda (Coca, Fanta, Sprite)', sectionSlug: 'boissons' },
  { name: 'Jus', sectionSlug: 'boissons' },
  { name: 'Thé glacé', sectionSlug: 'boissons' },
  { name: 'Thé japonais premium', sectionSlug: 'boissons' },
];

const SECTION_DEFS = [
  { slug: 'entrees', name: 'Entrées' },
  { slug: 'sushi-sashimi', name: 'Sushi & Sashimi' },
  { slug: 'maki-rolls', name: 'Maki & Rolls' },
  { slug: 'plats-chauds', name: 'Plats chauds' },
  { slug: 'formules', name: 'Formules' },
  { slug: 'desserts', name: 'Desserts' },
  { slug: 'boissons', name: 'Boissons' },
];

async function main() {
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) {
    throw new Error(
      'Missing SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD or VENDURE_ADMIN_USER/VENDURE_ADMIN_PASS'
    );
  }

  console.log('Logging in...');
  await login();
  console.log('Login successful');

  const channels = await getChannelsSafe();

  const sushiChannel =
    channels.find((c) => c.code === 'sushi-house') ||
    channels.find((c) => c.code === '__default_channel__') ||
    channels[0];

  if (sushiChannel?.code === 'sushi-house') {
    console.log('Using channel:', sushiChannel);
  } else if (sushiChannel) {
    console.log(
      `Channel sushi-house not found. Fallback to channel: ${sushiChannel.code}`
    );
  } else {
    console.log('No channel access. Continuing without channel assignment.');
  }

  let facet = await getFacetByCode('menu-section');

  if (!facet) {
    const created = await createFacetWithValues(
      'menu-section',
      'Menu section',
      SECTION_DEFS.map((s) => ({ code: s.slug, name: s.name }))
    );

    facet = created.createFacet;
    console.log('Facet created:', facet.code);
  } else {
    console.log('Facet exists:', facet.code);
  }

  const missingValues = SECTION_DEFS.filter(
    (s) => !facet!.values.some((v) => v.code === s.slug)
  );

  if (missingValues.length > 0) {
    const created = await createFacetValues(
      facet.id,
      missingValues.map((s) => ({ code: s.slug, name: s.name }))
    );

    console.log(
      'Facet values created:',
      created.createFacetValues.map((v) => v.code).join(', ')
    );

    facet = (await getFacetByCode('menu-section'))!;
  }

  await assignFacetsToChannelSafe([facet.id], sushiChannel?.id);

  const facetValueBySlug = new Map(
    facet.values.map((v) => [v.code, v] as const)
  );

  for (const row of PRODUCTS) {
    const productSearch = await searchProductsByName(row.name);
    const product = productSearch.products.items.find(
      (p) => p.name === row.name
    );

    if (!product) {
      console.log(`Product not found, skipped: ${row.name}`);
      continue;
    }

    const targetFacetValue = facetValueBySlug.get(row.sectionSlug);

    if (!targetFacetValue) {
      throw new Error(`Facet value missing for section ${row.sectionSlug}`);
    }

    const detail = await getProductDetail(product.id);

    const otherFacetValueIds = detail.product.facetValues
      .filter((fv) => fv.facet.code !== 'menu-section')
      .map((fv) => fv.id);

    const mergedFacetValueIds = Array.from(
      new Set([...otherFacetValueIds, targetFacetValue.id])
    );

    await updateProductFacetValues(product.id, mergedFacetValueIds);

    console.log(
      `Product assigned to menu section: ${row.name} -> ${row.sectionSlug}`
    );
  }

  for (const section of SECTION_DEFS) {
    const collection = await getCollectionBySlug(section.slug);

    if (!collection) {
      console.log(`Collection not found, skipped: ${section.slug}`);
      continue;
    }

    const facetValue = facetValueBySlug.get(section.slug);

    if (!facetValue) {
      throw new Error(`Facet value not found for collection ${section.slug}`);
    }

    await updateCollectionFacetFilter(collection.id, facetValue.id);
    console.log(`Collection filter updated: ${section.slug}`);
  }

  await runPendingSearchIndexUpdates();

  console.log('Search index refresh triggered');
  console.log('Menu-section facet/collection sync finished successfully');
}

main().catch((err) => {
  console.error('Seed failed:', err?.message || err);
  process.exit(1);
});