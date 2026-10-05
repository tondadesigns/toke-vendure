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
      channels?: Array<{ id: string; code: string; token: string }>;
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
            channels {
              id
              code
              token
            }
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

async function getChannels() {
  return gql<{
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
}

async function getSellers() {
  return gql<{
    sellers: { items: Array<{ id: string; name: string }> };
  }>(`
    query {
      sellers {
        items {
          id
          name
        }
      }
    }
  `);
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

async function createZone(name: string) {
  return gql<{
    createZone: { id: string; name: string };
  }>(
    `
      mutation CreateZone($input: CreateZoneInput!) {
        createZone(input: $input) {
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

async function createSeller(name: string) {
  return gql<{
    createSeller: { id: string; name: string };
  }>(
    `
      mutation CreateSeller($input: CreateSellerInput!) {
        createSeller(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: {
        name,
        customFields: {
          phone: '',
          addressLine1: '',
          commune: '',
          commissionPercent: 10,
        },
      },
    }
  );
}

async function createChannel(sellerId: string, defaultZoneId: string) {
  return gql<{
    createChannel:
      | { __typename: 'Channel'; id: string; code: string; token: string }
      | { __typename: 'ErrorResult'; errorCode: string; message: string };
  }>(
    `
      mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
          __typename
          ... on Channel {
            id
            code
            token
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
        code: 'sushi-house',
        token: 'sushi-house-token',
        sellerId,
        defaultLanguageCode: 'en',
        availableLanguageCodes: ['en'],
        defaultCurrencyCode: 'USD',
        availableCurrencyCodes: ['USD'],
        pricesIncludeTax: true,
        defaultTaxZoneId: defaultZoneId,
        defaultShippingZoneId: defaultZoneId,
      },
    }
  );
}

async function getCollections() {
  return gql<{
    collections: {
      items: Array<{ id: string; name: string; slug: string }>;
    };
  }>(`
    query {
      collections(options: { take: 100 }) {
        items {
          id
          name
          slug
        }
      }
    }
  `);
}

async function getCollectionBySlug(slug: string) {
  return gql<{
    collections: {
      items: Array<{ id: string; name: string; slug: string }>;
    };
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
          slug: {
            eq: slug,
          },
        },
      },
    }
  );
}

async function createCollection(
  input: Record<string, unknown>
): Promise<{ id: string; name: string; slug: string }> {
  const data = await gql<{
    createCollection: { id: string; name: string; slug: string };
  }>(
    `
      mutation CreateCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) {
          id
          name
          slug
        }
      }
    `,
    { input }
  );

  return data.createCollection;
}

async function assignCollectionsToChannel(
  collectionIds: string[],
  channelId: string
) {
  return gql<{
    assignCollectionsToChannel: Array<{
      id: string;
      name: string;
      slug: string;
    }>;
  }>(
    `
      mutation AssignCollectionsToChannel($input: AssignCollectionsToChannelInput!) {
        assignCollectionsToChannel(input: $input) {
          id
          name
          slug
        }
      }
    `,
    {
      input: {
        collectionIds,
        channelId,
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

async function ensureParentCollection(channelId: string) {
  const found = await getCollectionBySlug('sushi-house');
  const existing = found.collections.items[0];

  if (existing) {
    console.log('Parent collection exists:', existing);
    return existing;
  }

  const created = await createCollection({
  isPrivate: false,
  translations: [
      {
        languageCode: 'en',
        name: 'Sushi House',
        slug: 'sushi-house',
        description: 'Sushi japonais frais et authentique',
      },
    ],
    filters: [],
  });

  console.log('Parent collection created:', created);
  return created;
}

async function ensureSectionCollection(
  channelId: string,
  parentId: string,
  sectionName: string
) {
  const sectionSlug = slugify(sectionName);
  const found = await getCollectionBySlug(sectionSlug);
  const existing = found.collections.items[0];

  if (existing) {
    console.log(`Section exists: ${sectionName}`);
    return existing;
  }

  const created = await createCollection({
  isPrivate: false,
  parentId,
  translations: [
      {
        languageCode: 'en',
        name: sectionName,
        slug: sectionSlug,
        description: sectionName,
      },
    ],
    filters: [],
  });

  console.log(`Section created: ${sectionName}`, created);
  return created;
}

async function main() {
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) {
    throw new Error(
      'Missing SUPERADMIN_USERNAME or SUPERADMIN_PASSWORD in environment'
    );
  }

  console.log('Logging in...');
  await login();
  console.log('Login successful');

  console.log('Checking seller...');
  const sellers = await getSellers();
  let seller = sellers.sellers.items.find((s) => s.name === 'Sushi House');

  if (!seller) {
    const created = await createSeller('Sushi House');
    seller = created.createSeller;
    console.log('Seller created:', seller);
  } else {
    console.log('Seller exists:', seller);
  }

  console.log('Checking channel...');
  const channels = await getChannels();
  let channel = channels.channels.items.find((c) => c.code === 'sushi-house');

  if (!channel) {
    const zones = await getZones();
    let defaultZone = zones.zones.items[0];

    if (!defaultZone) {
      console.log('No zone found, creating one...');
      const createdZone = await createZone('Default Zone');
      defaultZone = createdZone.createZone;
      console.log('Zone created:', defaultZone);
    } else {
      console.log('Using existing zone:', defaultZone);
    }

    const created = await createChannel(seller.id, defaultZone.id);
    const result = created.createChannel;

    if (result.__typename !== 'Channel') {
      throw new Error(
        `Create channel failed: ${result.message || result.errorCode}`
      );
    }

    channel = result;
    console.log('Channel created:', channel);
  } else {
    console.log('Channel exists:', channel);
  }

  console.log('Ensuring parent collection...');
  const parent = await ensureParentCollection(channel.id);

  console.log('Ensuring section collections...');
  const sections = [
    'Lunch',
    'Formules',
    'Entrées',
    'Plats',
    'Desserts',
    'Boissons',
  ];

  const allCollectionIds: string[] = [parent.id];

  for (const section of sections) {
    const sectionCollection = await ensureSectionCollection(
      channel.id,
      parent.id,
      section
    );
    allCollectionIds.push(sectionCollection.id);
  }

  console.log('Assigning collections to sushi-house channel...');
  await assignCollectionsToChannel(allCollectionIds, channel.id);
  console.log('Collections assigned to channel');

  console.log('Seed finished successfully');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});