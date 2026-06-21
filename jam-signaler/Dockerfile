FROM node:20-alpine

WORKDIR /app

# Copy ONLY the prebuilt bundle (compiled upstream of the image build).
COPY dist/index.js ./

# Expose the signaling port (HTTP + WebSocket).
EXPOSE 8080

# Environment defaults — overridable at runtime via `docker run -e ...` or compose.
ENV PORT=8080
ENV LOG_LEVEL=info

CMD ["node", "index.js"]
