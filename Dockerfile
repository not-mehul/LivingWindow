# syntax=docker/dockerfile:1
#
# Living Window: build the static site with Node, then serve it from a tiny
# nginx image (uses well under 15 MB of RAM at runtime).
#
#   docker compose up -d        # then open http://<this-machine>:8080
#
# Base images can be swapped (e.g. for a registry mirror) with build args:
#   docker build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine \
#                --build-arg NGINX_IMAGE=mirror.gcr.io/library/nginx:alpine .

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine

# --- Build ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Type-check, unit-test and bundle; a failing test fails the image build.
RUN npm run typecheck && npm test && npx vite build

# --- Serve ----------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
