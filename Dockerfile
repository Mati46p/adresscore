# Produkcja na Hetznerze (Coolify). Etap 1 buduje SPA i katalog SEO, etap 2 to goły Node
# bez zależności: api/* i serwer/serwer.mjs używają wyłącznie modułów wbudowanych.
FROM node:24-alpine AS build
WORKDIR /app
RUN npm i -g pnpm@11.14.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY serwer ./serwer
USER node
EXPOSE 3000
CMD ["node", "serwer/serwer.mjs"]
