FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps first (cached layer). prisma/ is needed because `postinstall` runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    JWT_SECRET="placeholder-jwt-secret-for-build-purposes-only"
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
