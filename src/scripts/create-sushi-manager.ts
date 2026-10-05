import 'dotenv/config';

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  'https://toke-vendure-production.up.railway.app/admin-api';

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || '';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || '';

const RESTAURANT_IDENTIFIER =
  process.env.SUSHI_MANAGER_USERNAME || 'sushi-house-manager';

const RESTAURANT_PASSWORD =
  process.env.SUSHI_MANAGER_PASSWORD || '';

let sessionCookie = '';

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

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

async function login() {
  const data = await gql<{
    login: {
      __typename: string;
      errorCode?: string;
      message?: string;
    };
  }>(
    `
      mutation Login($username: String!, $password: String!) {
        login(
          username: $username
          password: $password
          rememberMe: true
        ) {
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

  if (data.login.__typename !== 'CurrentUser') {
    throw new Error(
      `Login failed: ${
        data.login.message ||
        data.login.errorCode ||
        data.login.__typename
      }`
    );
  }
}

async function getChannels() {
  return gql<{
    channels: {
      items: Array<{
        id: string;
        code: string;
      }>;
    };
  }>(`
    query {
      channels {
        items {
          id
          code
        }
      }
    }
  `);
}

async function getRoles() {
  return gql<{
    roles: {
      items: Array<{
        id: string;
        code: string;
        description: string;
        channels: Array<{
          id: string;
          code: string;
        }>;
      }>;
    };
  }>(`
    query {
      roles {
        items {
          id
          code
          description
          channels {
            id
            code
          }
        }
      }
    }
  `);
}

async function createRestaurantRole(channelId: string) {
  return gql<{
    createRole: {
      id: string;
      code: string;
      description: string;
    };
  }>(
    `
      mutation CreateRole($input: CreateRoleInput!) {
        createRole(input: $input) {
          id
          code
          description
        }
      }
    `,
    {
      input: {
        code: 'sushi-house-manager',
        description: 'Sushi House Manager',

        channelIds: [channelId],

permissions: [
  'Authenticated',

  // Menu / catalogue Sushi House
  'CreateCatalog',
  'ReadCatalog',
  'UpdateCatalog',

  // Commandes Sushi House
  'ReadOrder',
  'UpdateOrder',

  // Affichage des données Dashboard
  'ReadDashboardGlobalViews',
],
      },
    }
  );
}

async function getAdministrators() {
  return gql<{
    administrators: {
      items: Array<{
        id: string;
        emailAddress: string;
        user: {
          id: string;
          identifier: string;
        };
      }>;
    };
  }>(`
    query {
      administrators {
        items {
          id
          emailAddress
          user {
            id
            identifier
          }
        }
      }
    }
  `);
}

async function createRestaurantAdministrator(roleId: string) {
  return gql<{
    createAdministrator: {
      id: string;
      firstName: string;
      lastName: string;
      emailAddress: string;
      user: {
        id: string;
        identifier: string;
      };
    };
  }>(
    `
      mutation CreateAdministrator(
        $input: CreateAdministratorInput!
      ) {
        createAdministrator(input: $input) {
          id
          firstName
          lastName
          emailAddress
          user {
            id
            identifier
          }
        }
      }
    `,
    {
      input: {
        firstName: 'Sushi',
        lastName: 'House',
        emailAddress: RESTAURANT_IDENTIFIER,
        password: RESTAURANT_PASSWORD,
        roleIds: [roleId],
      },
    }
  );
}
async function main() {
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) {
    throw new Error(
      'Missing SUPERADMIN_USERNAME or SUPERADMIN_PASSWORD'
    );
  }

  if (!RESTAURANT_PASSWORD) {
    throw new Error(
      'Missing SUSHI_MANAGER_PASSWORD'
    );
  }

  console.log('Logging in as Toke superadmin...');
  await login();
  console.log('Login successful');

  console.log('Looking for Sushi House channel...');

  const channels = await getChannels();

  const sushiChannel = channels.channels.items.find(
    (channel) => channel.code === 'sushi-house'
  );

  if (!sushiChannel) {
    throw new Error('Channel sushi-house not found');
  }

  console.log('Sushi House channel:', sushiChannel);

  console.log('Checking Restaurant Manager role...');

  const roles = await getRoles();

  let role = roles.roles.items.find(
    (item) => item.code === 'sushi-house-manager'
  );

  if (!role) {
    const created = await createRestaurantRole(
      sushiChannel.id
    );

    role = {
      ...created.createRole,
      channels: [
        {
          id: sushiChannel.id,
          code: sushiChannel.code,
        },
      ],
    };

    console.log('Role created:', role);
  } else {
    console.log('Role already exists:', role);
  }

  console.log('Checking Sushi House administrator...');

  const administrators = await getAdministrators();

  const existingAdministrator =
    administrators.administrators.items.find(
      (administrator) =>
        administrator.user.identifier ===
        RESTAURANT_IDENTIFIER
    );

  if (existingAdministrator) {
    console.log(
      'Administrator already exists:',
      existingAdministrator
    );

    console.log('Nothing else to create.');
    return;
  }

const createdAdministrator =
  await createRestaurantAdministrator(role.id);

console.log(
  'Administrator created:',
  createdAdministrator.createAdministrator
);

  console.log('');
  console.log('Sushi House Manager ready');
  console.log('Identifier:', RESTAURANT_IDENTIFIER);
  console.log('Channel: sushi-house');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});