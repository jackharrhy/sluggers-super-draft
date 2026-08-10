FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts/package.json ./contracts/package.json
COPY contracts/src ./contracts/src
COPY web/package.json web/package-lock.json ./web/
WORKDIR /app/web
RUN npm ci --omit=dev

COPY web ./

USER node
EXPOSE 3000

CMD ["npm", "start"]
