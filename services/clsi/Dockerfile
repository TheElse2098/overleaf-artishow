# This file was auto-generated, do not edit it directly.
# Instead run bin/update_build_scripts from
# https://github.com/overleaf/internal/

FROM node:24.14.1 AS base

# Corepack setup, shared between all the images.
ENV PATH="/overleaf/node_modules/.bin:$PATH"
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack install -g yarn@4.14.1
ENV COREPACK_ENABLE_NETWORK=0

WORKDIR /overleaf/services/clsi
COPY services/clsi/install_deps.sh /overleaf/services/clsi/
RUN chmod 0755 ./install_deps.sh && ./install_deps.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
COPY services/clsi/entrypoint.sh /

# Google Cloud Storage needs a writable $HOME/.config for resumable uploads
# (see https://googleapis.dev/nodejs/storage/latest/File.html#createWriteStream)
RUN mkdir /home/node/.config && chown node:node /home/node/.config

FROM base AS app

COPY package.json yarn.lock .yarnrc.yml /overleaf/
COPY libraries/eslint-plugin/package.json /overleaf/libraries/eslint-plugin/package.json
COPY libraries/fetch-utils/package.json /overleaf/libraries/fetch-utils/package.json
COPY libraries/logger/package.json /overleaf/libraries/logger/package.json
COPY libraries/metrics/package.json /overleaf/libraries/metrics/package.json
COPY libraries/o-error/package.json /overleaf/libraries/o-error/package.json
COPY libraries/overleaf-editor-core/package.json /overleaf/libraries/overleaf-editor-core/package.json
COPY libraries/promise-utils/package.json /overleaf/libraries/promise-utils/package.json
COPY libraries/settings/package.json /overleaf/libraries/settings/package.json
COPY libraries/stream-utils/package.json /overleaf/libraries/stream-utils/package.json
COPY services/clsi/package.json /overleaf/services/clsi/package.json
COPY .yarn/patches/ /overleaf/.yarn/patches/

RUN cd /overleaf && yarn workspaces focus @overleaf/clsi overleaf
COPY libraries/eslint-plugin/ /overleaf/libraries/eslint-plugin/
COPY libraries/fetch-utils/ /overleaf/libraries/fetch-utils/
COPY libraries/logger/ /overleaf/libraries/logger/
COPY libraries/metrics/ /overleaf/libraries/metrics/
COPY libraries/o-error/ /overleaf/libraries/o-error/
COPY libraries/overleaf-editor-core/ /overleaf/libraries/overleaf-editor-core/
COPY libraries/promise-utils/ /overleaf/libraries/promise-utils/
COPY libraries/settings/ /overleaf/libraries/settings/
COPY libraries/stream-utils/ /overleaf/libraries/stream-utils/
COPY services/clsi/ /overleaf/services/clsi/

FROM app AS with-texlive

# NB (fork Artishow) : divergence ASSUMÉE par rapport au Dockerfile auto-généré.
# L'upstream installait TeXLive via
#   apt-cache depends texlive-full | grep Depends | ... | xargs apt-get install
# Cette tuyauterie échouait (xargs → exit 123). On installe donc texlive-full
# directement : apt résout l'arbre de dépendances proprement.
#
# texlive-full s'installe bien, mais ImageMagick (tiré via asymptote/pstoedit/
# inkscape) échoue à se CONFIGURER en conteneur : ses scripts postinst tombent
# sur debconf sans TTY ("falling back to frontend: Teletype") et sur le conffile
# /etc/ImageMagick-6/policy.xml déjà patché par install_deps.sh (étape base).
# → DEBIAN_FRONTEND=noninteractive neutralise les prompts debconf ;
#   -o Dpkg::Options "confdef/confold" résout les conffiles sans interaction
#   (garde la version déjà patchée). Ça débloque imagemagick-6-common & co.
# Si bin/update_build_scripts est un jour relancé, REPORTER ce correctif.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        -o Dpkg::Options::="--force-confdef" \
        -o Dpkg::Options::="--force-confold" \
        texlive-full \
        fontconfig \
        inkscape \
        python3-pygments \
        qpdf \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p cache compiles output \
&&  chown node:node cache compiles output

CMD ["node", "--expose-gc", "app.js"]

FROM app
RUN mkdir -p cache compiles output \
&&  chown node:node cache compiles output

CMD ["node", "--expose-gc", "app.js"]
