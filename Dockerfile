FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts/package.json contracts/package-lock.json ./contracts/
COPY contracts/src ./contracts/src
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --omit=dev --prefix /app/contracts \
  && npm ci --omit=dev --prefix /app/web

WORKDIR /app/web
COPY web ./

USER node
EXPOSE 3000

CMD ["npm", "start"]
