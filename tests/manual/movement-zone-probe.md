# Comparaison dans Foundry v14

Cette sonde n'est jamais chargée par le module. Elle observe un déplacement manuel, sans modifier le token, les régions, le budget ou l'historique partagé. Elle se désactive après le premier événement observé ; `probe.stop()` permet de l'arrêter avant.

1. Ouvrir la scène exportée `fvtt-Scene-scene-IBfnVvEqNBwEoBMt.json` dans Foundry 14.370 / CO2. Sélectionner un token 1×1 avec l'action `walk`, à une élévation comprise entre 0 et 6 m.
2. Dans la console du navigateur, exécuter :

```js
const { captureNextMovement } = await import("/modules/co2prism/tests/manual/movement-zone-probe.mjs");
let probe = captureNextMovement();
```

3. Effectuer manuellement un déplacement d'une case entièrement dans la région. Examiner `probe.report` : `actualPassed`, `path`, `regional`, `checked`, `final`, coûts des sections, `actualPassedCost`, `zoneCandidateCost` et `differenceFromTracker`. La grille de cette scène utilise 1,5 m par case ; comparer les coûts en mètres avant de les convertir en cases.
4. Réarmer avec `probe = captureNextMovement()` pour une entrée, une sortie, un contournement, puis les mêmes essais hors de l'intervalle d'élévation. Refaire avec un token 0,5×0,5 et plusieurs règles de diagonales. Un historique antérieur peut expliquer une différence avec `actualPassedCost` ; la sonde conserve cet historique dans le rapport. Le tracker de comparaison commence une nouvelle session à l'armement.
5. Activer la Zone Tactique sur ces mêmes positions et vérifier les destinations retenues et le carré rouge de l'origine. Déplacer le token : les marqueurs doivent rester fixes. Fermer/réouvrir la session puis réactiver : l'origine doit changer.

Pour transmettre un rapport sans les objets cycliques du moteur : `copy(JSON.stringify(probe.report, null, 2))` dans les outils de développement du navigateur.

Les tests Node, même lorsqu'ils exécutent des méthodes extraites du Core, ne remplacent pas ces essais dans le monde actif. Aucun résultat manuel n'est présumé acquis.
