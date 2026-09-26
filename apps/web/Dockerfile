FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
ARG VITE_API_URL=/api
ARG VITE_REQUIRE_MAX_LAUNCH=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_REQUIRE_MAX_LAUNCH=$VITE_REQUIRE_MAX_LAUNCH
COPY apps/web apps/web
RUN npm run build -w @navigator/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
