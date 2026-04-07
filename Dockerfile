FROM node:22-slim

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
  ffmpeg \
  python3 \
  python3-pip \
  curl \
  && rm -rf /var/lib/apt/lists/*

# Instala yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# Verifica instalação
RUN yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["node", "dist/bot.js"]