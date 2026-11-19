FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

COPY . .

ENV EXPO_PUBLIC_API_URL=https://api.nobai245.com
ENV EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg
ENV NODE_ENV=production

RUN npx expo export --platform web && node scripts/inject-pwa.js

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
