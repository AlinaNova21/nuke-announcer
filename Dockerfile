FROM node:10
ENV NODE_ENV=production
WORKDIR /app
COPY package.json .
RUN yarn
COPY . .
CMD ["yarn","start"]