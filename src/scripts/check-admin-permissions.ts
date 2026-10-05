import 'dotenv/config';

const ADMIN_API =
  process.env.RAILWAY_ADMIN_API ||
  'https://toke-vendure-production.up.railway.app/admin-api';

const USER =
  process.env.SUPERADMIN_USERNAME ||
  process.env.VENDURE_ADMIN_USER ||
  'superadmin';

const PASS =
  process.env.SUPERADMIN_PASSWORD ||
  process.env.VENDURE_ADMIN_PASS ||
  'superadmin';

let cookie = '';

async function gql(query: string, variables: any = {}) {
  const res = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

const setCookie = res.headers.get('set-cookie');

if (setCookie) {
  cookie = setCookie
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .join('; ');
}

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

async function main() {
  await gql(
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
            permissions
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
      username: USER,
      password: PASS,
    }
  );
  await gql(`
  query {
    channels {
      items {
        id
        code
        token
        seller {
          id
          name
        }
      }
      totalItems
    }
  }
`);
await gql(`
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
        permissions
      }
      totalItems
    }

    administrators {
      items {
        id
        firstName
        lastName
        emailAddress
        user {
          id
          identifier
        }
      }
      totalItems
    }
  }
`);
}

main();