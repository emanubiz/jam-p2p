FROM node:20-alpine

WORKDIR /app

# Copia SOLO la dist (il bundle già compilato)
COPY dist/index.js ./

# Esponi la porta
EXPOSE 8080

# Variabili d'ambiente
ENV PORT=8080
ENV LOG_LEVEL=info

# Avvia il server
CMD ["node", "index.js"]