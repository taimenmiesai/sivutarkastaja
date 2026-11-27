# Playwrightin virallinen kuva sisältää Chromiumin ja sen järjestelmäkirjastot.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

USER pwuser
EXPOSE 3000
CMD ["node", "server.js"]
