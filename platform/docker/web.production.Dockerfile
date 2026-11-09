# VEYE web — production image. Built and pushed, never run locally.
#
# Separate from web.Dockerfile, which bind-mounts the working tree and runs the
# development server. This one builds once and ships only what is needed to
# serve it.
#
# NEXT_PUBLIC_API_URL is inlined into the client bundle at BUILD time, not read
# at runtime. That is a property of Next, not a choice here: it means one image
# cannot serve two environments, and staging and production need separate
# builds. Everything else about the two is identical.

# ---- build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time only. A wrong value here produces a bundle that talks to the wrong
# API, which is why the build arg is required rather than defaulted.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Standalone output: a self-contained server plus only the dependencies it
# actually imports, instead of the whole node_modules tree. Set through the
# environment so the local build and the acceptance suite are untouched.
ENV NEXT_OUTPUT=standalone
ENV NODE_ENV=production

RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 veye \
 && useradd --system --uid 1001 --gid veye --home /app --shell /usr/sbin/nologin veye

WORKDIR /app

# Standalone puts the server and its minimal dependencies here; static assets
# and public files are copied beside it because the server does not bundle them.
COPY --from=build --chown=veye:veye /app/.next/standalone ./
COPY --from=build --chown=veye:veye /app/.next/static ./.next/static
COPY --from=build --chown=veye:veye /app/public ./public

USER veye

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/login'},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# PID 1, so a stop signal reaches the server.
CMD ["node", "server.js"]
