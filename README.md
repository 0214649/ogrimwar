# Ogrimwar

Guide de progression Dofus 3.7 pour faire tous les succès en team, étape par étape dans l'ordre du **GP0 de Ganymède** : pour chaque étape, les succès qu'elle termine ou fait avancer, les rappels « ×4 », les fiches de donjon et la page Dofus pour les Noobs en panneau. Profils multiples (un par team), progression gardée dans le navigateur, transférable par code.

Site : https://0214649.github.io/carnet-team/

## Sources

- **Guides Ganymède** (https://ganymede-app.com) : chargés en direct depuis leur API publique par le navigateur. Aucun contenu Ganymède n'est stocké dans ce dépôt. `route.json` ne contient que des numéros d'étapes (quelle plage de quel guide suit chaque étape du GP0).
- **Noms et descriptions officiels des succès (FR)** : lus en local dans les fichiers du jeu installé (copie, lecture seule) par `tools/extract_game.py` ; rien du client n'est stocké ici à part ces textes dans `ach.json`.
- **Succès et objectifs** : [DofusWiki](https://dofuswiki.fandom.com) (Fandom), sous licence [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). `ach.json` est dérivé de leurs modules `Datatable/Achievements`, `Datatable/*/ILLs` et des pages de donjons, et il est distribué sous la même licence.

Site non officiel. Dofus © Ankama Games.

## Reconstruire les données

```sh
python3 tools/fetch_guides.py tools/cache   # guides Ganymède (lent exprès : leur API limite les rafales)
python3 tools/expand.py tools/cache         # plages de sous-guides citées par chaque étape du GP0
python3 tools/make_route.py                 # -> route.json
python3 tools/build_ach.py                  # -> ach.json (wiki dans tools/wiki/)
```

`tools/fetch_guides.py` attend `tools/cache/gp_list.json` (`https://ganymede-app.com/api/guides?status=gp`).
