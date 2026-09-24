FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
RUN npm install

FROM deps AS build
COPY apps/bot apps/bot
RUN npm run build -w @navigator/bot

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/bot/package.json apps/bot/package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/bot/dist apps/bot/dist
USER node
EXPOSE 3002
CMD ["node", "apps/bot/dist/server.js"]
