
import 'dotenv/config';

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  'https://toke-vendure-production.up.railway.app/admin-api';

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || '';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || '';

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

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

async function getChannelByCode(code: string) {
  const data = await gql<{
    channels: { items: Array<{ id: string; code: string; token: string }> };
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

  return data.channels.items.find((c) => c.code === code);
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
        take: 100,
        filter: {
          slug: { eq: slug },
        },
      },
    }
  );

  return data.collections.items[0];
}
async function getZones() {
  return gql<{
    zones: { items: Array<{ id: string; name: string }> };
  }>(`
    query {
      zones {
        items {
          id
          name
        }
      }
    }
  `);
}
async function getTaxCategories() {
  return gql<{
    taxCategories: { items: Array<{ id: string; name: string }> };
  }>(`
    query {
      taxCategories {
        items {
          id
          name
        }
      }
    }
  `);
}

async function createTaxCategory(name: string) {
  return gql<{
    createTaxCategory: { id: string; name: string };
  }>(
    `
      mutation CreateTaxCategory($input: CreateTaxCategoryInput!) {
        createTaxCategory(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: { name },
    }
  );
}
async function searchProductsByName(term: string) {
  return gql<{
    products: { items: Array<{ id: string; name: string; slug: string }> };
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

async function createProduct(input: Record<string, unknown>) {
  return gql<{
    createProduct: {
      id: string;
      name: string;
      slug: string;
    };
  }>(
    `
      mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
          name
          slug
        }
      }
    `,
    { input }
  );
}

async function createProductVariants(productId: string, variantName: string, taxCategoryId: string) {
  return gql<{
    createProductVariants: Array<{
      id: string;
      name: string;
    }>;
  }>(
    `
      mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: [
        {
          productId,
          translations: [
            {
              languageCode: 'en',
              name: variantName,
            },
          ],
          sku: `${productId}-${variantName}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-'),
          stockOnHand: 999,
          trackInventory: 'FALSE',
          taxCategoryId,
        },
      ],
    }
  );
}

async function getProductWithVariants(productId: string) {
  return gql<{
    product: {
      id: string;
      name: string;
      variants: Array<{ id: string; name: string }>;
    };
  }>(
    `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          name
          variants {
            id
            name
          }
        }
      }
    `,
    { id: productId }
  );
}

async function assignProductsToChannel(productIds: string[], channelId: string) {
  return gql<{
    assignProductsToChannel: Array<{ id: string; name: string; slug: string }>;
  }>(
    `
      mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
          id
          name
          slug
        }
      }
    `,
    {
      input: {
        productIds,
        channelId,
      },
    }
  );
}

async function updateProductVariant(
  variantId: string,
  price: number,
  taxCategoryId: string
) {
  return gql<{
    updateProductVariants: Array<{
      id: string;
      name: string;
    }>;
  }>(
    `
      mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: [
        {
          id: variantId,
          stockOnHand: 999,
          trackInventory: 'FALSE',
          price,
          taxCategoryId,
          featuredAssetId: null,
          
        },
      ],
    }
  );
}


async function updateChannelZones(channelId: string, zoneId: string) {
  return gql<{
    updateChannel:
      | { __typename: 'Channel'; id: string; code: string }
      | { __typename: 'ErrorResult'; errorCode: string; message: string };
  }>(
    `
      mutation UpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
          __typename
          ... on Channel {
            id
            code
          }
          ... on ErrorResult {
            errorCode
            message
          }
        }
      }
    `,
    {
      input: {
        id: channelId,
        defaultTaxZoneId: zoneId,
        defaultShippingZoneId: zoneId,
      },
    }
  );
}
function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PRODUCTS = [
  { name: 'Soupe miso', price: 250, sectionSlug: 'entrees' },
  { name: 'Salade wakame', price: 450, sectionSlug: 'entrees' },
  { name: 'Edamame', price: 400, sectionSlug: 'entrees' },
  { name: 'Edamame épicé', price: 450, sectionSlug: 'entrees' },
  { name: 'Gyoza (5 pcs)', price: 600, sectionSlug: 'entrees' },
  { name: 'Tempura crevettes (4 pcs)', price: 850, sectionSlug: 'entrees' },
  { name: 'Tempura légumes', price: 650, sectionSlug: 'entrees' },

  { name: 'Sushi saumon (2 pcs)', price: 500, sectionSlug: 'sushi-sashimi' },
  { name: 'Sushi thon (2 pcs)', price: 550, sectionSlug: 'sushi-sashimi' },
  { name: 'Sushi crevette (2 pcs)', price: 450, sectionSlug: 'sushi-sashimi' },
  { name: 'Sashimi saumon (6 pcs)', price: 1000, sectionSlug: 'sushi-sashimi' },
  { name: 'Sashimi thon (6 pcs)', price: 1100, sectionSlug: 'sushi-sashimi' },
  { name: 'Mix sushi (8 pcs)', price: 1400, sectionSlug: 'sushi-sashimi' },
  { name: 'Mix sashimi (10 pcs)', price: 1800, sectionSlug: 'sushi-sashimi' },

  { name: 'California roll', price: 900, sectionSlug: 'maki-rolls' },
  { name: 'Spicy tuna roll', price: 1050, sectionSlug: 'maki-rolls' },
  { name: 'Salmon avocado roll', price: 1000, sectionSlug: 'maki-rolls' },
  { name: 'Philadelphia roll', price: 1100, sectionSlug: 'maki-rolls' },
  { name: 'Dragon roll', price: 1350, sectionSlug: 'maki-rolls' },
  { name: 'Veggie roll', price: 850, sectionSlug: 'maki-rolls' },

  { name: 'Poulet teriyaki + riz', price: 1200, sectionSlug: 'plats-chauds' },
  { name: 'Saumon teriyaki + riz', price: 1450, sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba poulet', price: 1100, sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba crevettes', price: 1300, sectionSlug: 'plats-chauds' },
  { name: 'Yakisoba légumes', price: 950, sectionSlug: 'plats-chauds' },
  { name: 'Riz sauté', price: 800, sectionSlug: 'plats-chauds' },
  { name: 'Bento box', price: 1600, sectionSlug: 'plats-chauds' },

  { name: 'Menu Lunch (12 pcs + boisson)', price: 1450, sectionSlug: 'formules' },
  { name: 'Menu Duo (24 pcs)', price: 2600, sectionSlug: 'formules' },
  { name: 'Menu Family (48 pcs)', price: 4800, sectionSlug: 'formules' },
  { name: 'Box Premium', price: 3200, sectionSlug: 'formules' },

  { name: 'Mochi glacé (2 pcs)', price: 550, sectionSlug: 'desserts' },
  { name: 'Tempura banane', price: 650, sectionSlug: 'desserts' },
  { name: 'Cheesecake japonais', price: 600, sectionSlug: 'desserts' },
  { name: 'Glace', price: 400, sectionSlug: 'desserts' },

  { name: 'Eau minérale', price: 150, sectionSlug: 'boissons' },
  { name: 'Soda (Coca, Fanta, Sprite)', price: 250, sectionSlug: 'boissons' },
  { name: 'Jus', price: 350, sectionSlug: 'boissons' },
  { name: 'Thé glacé', price: 300, sectionSlug: 'boissons' },
  { name: 'Thé japonais premium', price: 450, sectionSlug: 'boissons' },
];

async function main() {
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) {
    throw new Error('Missing SUPERADMIN_USERNAME or SUPERADMIN_PASSWORD');
  }

  console.log('Logging in...');
  await login();
  console.log('Login successful');

const channelsData = await gql<{
  channels: { items: Array<{ id: string; code: string; token: string }> };
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

const channel = channelsData.channels.items.find((c) => c.code === 'sushi-house');
if (!channel) {
  throw new Error('Channel sushi-house not found');
}

console.log('Using channel:', channel);

const zones = await getZones();
const defaultZone = zones.zones.items[0];
if (!defaultZone) {
  throw new Error('No zone found. Run the sections/structure seed first.');
}

console.log('Using zone:', defaultZone);

const taxCategories = await getTaxCategories();
let defaultTaxCategory = taxCategories.taxCategories.items[0];

if (!defaultTaxCategory) {
  console.log('No tax category found, creating one...');
  const createdTaxCategory = await createTaxCategory('Default Tax Category');
  defaultTaxCategory = createdTaxCategory.createTaxCategory;
  console.log('Tax category created:', defaultTaxCategory);
} else {
  console.log('Using tax category:', defaultTaxCategory);
}

for (const ch of channelsData.channels.items) {
  const updated = await updateChannelZones(ch.id, defaultZone.id);
  const result = updated.updateChannel;

  if (result.__typename !== 'Channel') {
    throw new Error(
      `Update channel zones failed for ${ch.code}: ${result.message || result.errorCode}`
    );
  }

  console.log(`Channel zones set: ${result.code}`);
}

  const createdVariantIdsBySection: Record<string, string[]> = {};

  for (const item of PRODUCTS) {
    console.log(`Checking product: ${item.name}`);
    const existing = await searchProductsByName(item.name);
    let product = existing.products.items.find((p) => p.name === item.name);

    let variantId: string;

    if (!product) {
      const created = await createProduct({
        enabled: true,
        translations: [
          {
            languageCode: 'en',
            name: item.name,
            slug: slugify(item.name),
            description: '',
          },
        ],
      });

      product = {
        id: created.createProduct.id,
        name: created.createProduct.name,
        slug: created.createProduct.slug,
      };

      const createdVariants = await createProductVariants(
  product.id,
  item.name,
  defaultTaxCategory.id
);
      variantId = createdVariants.createProductVariants[0]?.id;

      if (!variantId) {
        throw new Error(`No variant created for ${item.name}`);
      }

      console.log(`Product created: ${item.name}`);
    } else {
      console.log(`Product already exists: ${item.name}`);

      const lookup = await getProductWithVariants(product.id);
      let foundVariant = lookup.product.variants.find((v) => v.name === item.name);

      if (!foundVariant) {
        const createdVariants = await createProductVariants(
  product.id,
  item.name,
  defaultTaxCategory.id
);
        variantId = createdVariants.createProductVariants[0]?.id;

        if (!variantId) {
          throw new Error(`No variant created for existing product ${item.name}`);
        }
      } else {
        variantId = foundVariant.id;
      }
    }

    await assignProductsToChannel([product.id], channel.id);
    await updateProductVariant(
  variantId,
  item.price,
  defaultTaxCategory.id
);

    if (!createdVariantIdsBySection[item.sectionSlug]) {
      createdVariantIdsBySection[item.sectionSlug] = [];
    }
    createdVariantIdsBySection[item.sectionSlug].push(variantId);
  }



  console.log('Product seed finished successfully');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
