FROM debian:testing-slim

RUN apt-get update && \
    apt-cache depends texlive-full | grep "Depends: " | grep -v -- "-doc" | grep -v -- "-lang-" | sed 's/Depends: //' | xargs apt-get install -y --no-install-recommends && \
    apt-get install -y --no-install-recommends fontconfig inkscape pandoc python3-pygments && \
    rm -rf /var/lib/apt/lists/*

RUN useradd tex
USER tex
