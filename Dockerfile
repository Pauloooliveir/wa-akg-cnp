FROM node:26-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Provide fallback build-time environment variables so next build succeeds without host .env
ENV DATABASE_URL="postgresql://build_user:build_pass@localhost:5432/wa_akg"
ENV AUTH_SECRET="build_secret_must_be_at_least_32_characters_long_for_nextjs"
ENV NEXTAUTH_SECRET="build_secret_must_be_at_least_32_characters_long_for_nextjs"

# NODE_ENV=production faria o npm ci pular as devDependencies (prisma, typescript...): --include=dev
# Dependency layer — cache-friendly: only rerun when package*.json changes
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --legacy-peer-deps --include=dev && npm cache clean --force

# Source & build
COPY . .
RUN npx --no-install prisma generate && npm run build

# Sem "npm prune": tsx (roda o servidor) e prisma (db push no boot) são devDependencies, e com
# NODE_ENV=production o reinstall depois do prune os pulava em silêncio. As versões vêm do lockfile.

# Production image
FROM node:26-alpine AS runner
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/next.config.ts ./
COPY --from=builder --chown=node:node /app/scripts ./scripts

# Create data and upload directories with appropriate non-root ownership
RUN mkdir -p /app/data/media /app/data/auth /app/uploads && chown -R node:node /app/data /app/uploads

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["sh", "-c", "npx --no-install prisma db push && (if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
