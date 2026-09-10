FROM node:22-alpine
WORKDIR /app
COPY package.json bot.mjs ./
RUN mkdir -p /app/data
ENV NODE_ENV=production
CMD ["node", "bot.mjs"]
