FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep openssh-client unzip \
  && npm install -g opencode-ai \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 4096

CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
