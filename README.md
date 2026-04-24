### La compilation marche en donnant les permissions avec les commandes suivantes

```bash
docker exec sharelatex bash -c "chown -R www-data:www-data /var/lib/overleaf/data/git/ && chown -R www-data:www-data /var/lib/overleaf/data/compiles/"
```