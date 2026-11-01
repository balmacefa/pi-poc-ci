# Escenario ficticio: imagen base deliberadamente antigua para simular CVEs de SO
# (p. ej. openssl). El enjambre NO debe parchear esto: solo investigar liviano y reportar.
FROM node:14-buster

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "index.js"]
