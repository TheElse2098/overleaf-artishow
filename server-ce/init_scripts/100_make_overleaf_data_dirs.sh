#!/bin/sh
set -e

# saml certs
mkdir -p /var/lib/overleaf/certs
chown www-data:www-data /var/lib/overleaf/certs

mkdir -p /var/lib/overleaf/data
chown www-data:www-data /var/lib/overleaf/data

mkdir -p /var/lib/overleaf/data/user_files
chown www-data:www-data /var/lib/overleaf/data/user_files

mkdir -p /var/lib/overleaf/data/compiles
chown -R www-data:www-data /var/lib/overleaf/data/compiles

mkdir -p /var/lib/overleaf/data/output
chown www-data:www-data /var/lib/overleaf/data/output

mkdir -p /var/lib/overleaf/data/cache
chown -R www-data:www-data /var/lib/overleaf/data/cache

mkdir -p /var/lib/overleaf/data/template_files
chown www-data:www-data /var/lib/overleaf/data/template_files

mkdir -p /var/lib/overleaf/data/history
chown -R www-data:www-data /var/lib/overleaf/data/history

# git
mkdir -p /var/lib/overleaf/data/git
mkdir -p /var/lib/overleaf/data/git/keys
chown -R www-data:www-data /var/lib/overleaf/data/git

mkdir -p /var/lib/overleaf/tmp/projectHistories
chown www-data:www-data /var/lib/overleaf/tmp/projectHistories

mkdir -p /var/lib/overleaf/tmp/dumpFolder
chown www-data:www-data /var/lib/overleaf/tmp/dumpFolder

mkdir -p /var/lib/overleaf/tmp
chown www-data:www-data /var/lib/overleaf/tmp

mkdir -p /var/lib/overleaf/tmp/uploads
chown www-data:www-data /var/lib/overleaf/tmp/uploads

mkdir -p /var/lib/overleaf/tmp/dumpFolder
chown www-data:www-data /var/lib/overleaf/tmp/dumpFolder
