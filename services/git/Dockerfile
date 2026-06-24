# Image du service git autonome (pour Kubernetes).
# Calquée sur la convention monorepo Overleaf : yarn workspaces + libraries partagées.

# --- Étape de base : Node + yarn (corepack), identique aux autres services ---
FROM node:24.14.1 AS base

ENV PATH="/overleaf/node_modules/.bin:$PATH"
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack install -g yarn@4.14.1
ENV COREPACK_ENABLE_NETWORK=0

# Le service appelle git et ssh en ligne de commande (clone, push, GIT_SSH_COMMAND)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /overleaf/services/git

# --- Étape app : dépendances puis code source ---
FROM base AS app

# 1. D'abord les package.json (cache : on ne réinstalle que s'ils changent).
# yarn workspaces focus résout le graphe COMPLET du workspace racine "overleaf"
# (qui référence @overleaf/eslint-plugin, etc.) → tous les package.json des
# libraries doivent être présents, sinon "Workspace not found".
COPY package.json yarn.lock .yarnrc.yml /overleaf/
COPY libraries/access-token-encryptor/package.json /overleaf/libraries/access-token-encryptor/package.json
COPY libraries/eslint-plugin/package.json /overleaf/libraries/eslint-plugin/package.json
COPY libraries/fetch-utils/package.json /overleaf/libraries/fetch-utils/package.json
COPY libraries/logger/package.json /overleaf/libraries/logger/package.json
COPY libraries/metrics/package.json /overleaf/libraries/metrics/package.json
COPY libraries/mongo-utils/package.json /overleaf/libraries/mongo-utils/package.json
COPY libraries/o-error/package.json /overleaf/libraries/o-error/package.json
COPY libraries/object-persistor/package.json /overleaf/libraries/object-persistor/package.json
COPY libraries/overleaf-editor-core/package.json /overleaf/libraries/overleaf-editor-core/package.json
COPY libraries/promise-utils/package.json /overleaf/libraries/promise-utils/package.json
COPY libraries/ranges-tracker/package.json /overleaf/libraries/ranges-tracker/package.json
COPY libraries/redis-wrapper/package.json /overleaf/libraries/redis-wrapper/package.json
COPY libraries/settings/package.json /overleaf/libraries/settings/package.json
COPY libraries/stream-utils/package.json /overleaf/libraries/stream-utils/package.json
COPY libraries/validation-tools/package.json /overleaf/libraries/validation-tools/package.json
COPY services/git/package.json /overleaf/services/git/package.json
COPY .yarn/patches/ /overleaf/.yarn/patches/

# 2. Installe uniquement les deps du workspace git (+ racine)
RUN cd /overleaf && yarn workspaces focus @overleaf/git overleaf

# 3. Puis le code (change souvent → en dernier pour préserver le cache)
COPY libraries/fetch-utils/ /overleaf/libraries/fetch-utils/
COPY libraries/logger/ /overleaf/libraries/logger/
COPY libraries/metrics/ /overleaf/libraries/metrics/
COPY libraries/o-error/ /overleaf/libraries/o-error/
COPY libraries/settings/ /overleaf/libraries/settings/
COPY services/git/ /overleaf/services/git/

# Dossier des données (working trees + clés SSH). En k8s : à monter sur un volume persistant.
RUN mkdir -p /var/lib/overleaf/data/git \
    && chown -R node:node /var/lib/overleaf/data/git

# --- Image finale ---
FROM app
USER node

EXPOSE 3099

CMD ["node", "app.js"]
