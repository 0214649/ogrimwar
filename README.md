# Carnet de la Team

Guide de progression Dofus 3.7 pour une team de 4, étape par étape dans l'ordre du **GP0 de Ganymède**, avec pour chaque étape les succès qu'elle termine ou fait avancer. Une seule progression pour toute la team.

Site : https://0214649.github.io/carnet-team/

## Sources

- **Guides Ganymède** (https://ganymede-app.com) : chargés en direct depuis leur API publique par le navigateur. Aucun contenu Ganymède n'est stocké dans ce dépôt. `route.json` ne contient que des numéros d'étapes (quelle plage de quel guide suit chaque étape du GP0).
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
