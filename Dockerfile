FROM node:20

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

# Les devDependencies sont nécessaires pour compiler
# Vendure et le Dashboard
RUN npm ci

COPY . .

# Compile le serveur Vendure
RUN npm run build

# Compile le Dashboard Vendure
RUN npm run build:dashboard

ENV NODE_ENV=production

CMD ["npm", "start"]