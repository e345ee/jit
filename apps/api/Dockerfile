FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY content content
RUN npm run build -w @navigator/shared && npm run build -w @navigator/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --omit=dev
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY content content
COPY infra/postgres/migrations infra/postgres/migrations
ENV CONTENT_DIR=/app/content
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
