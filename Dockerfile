FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev

COPY web ./

USER node
EXPOSE 3000

CMD ["npm", "start"]
