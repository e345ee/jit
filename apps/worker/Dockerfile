FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
RUN npm install

FROM deps AS build
COPY infra/postgres/migrations infra/postgres/migrations
COPY apps/worker apps/worker
RUN npm run build -w @navigator/worker

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/worker/package.json apps/worker/package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY infra/postgres/migrations infra/postgres/migrations
USER node
CMD ["node", "apps/worker/dist/worker.js"]
