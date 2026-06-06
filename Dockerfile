# Base image
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl curl

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js
RUN npm run build

# Build worker
RUN npm run build:worker
# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy the built worker
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# Copy Prisma schema and migrations so startup can run `prisma migrate deploy`
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Install prisma CLI for migrations in entrypoint
# We do this as root before switching user so it installs cleanly
RUN npm install prisma

# Copy entrypoint
COPY --from=builder --chown=nextjs:nodejs /app/entrypoint.sh ./
RUN sed -i 's/\r$//' entrypoint.sh
RUN chmod +x entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./entrypoint.sh"]

# Next.js startup
CMD ["node", "server.js"]
