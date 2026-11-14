# CO2 Prism

Module pour Foundry VTT v14 et Chroniques Oubliées 2 (`co2`), initialement pour Fantasy.

Étape 06 : barre reliée à l'acteur du token contrôlé, avec ses commandes de base et sa configuration par acteur. Nom, portrait et quatre jauges dynamiques en HTML/CSS, avec les icônes Font Awesome Solid de Foundry.

Une sélection unique affiche les données préparées de `token.actor`, à condition de disposer du droit Observateur. Sans sélection, en sélection multiple ou sans autorisation, la barre affiche un portrait temporaire et des tirets. Les rencontres affichent les PV et les seules ressources réellement disponibles. Un maximum absent, non fini ou inférieur ou égal à zéro est remplacé par un tiret ; le remplissage reste vide, sans inventer de maximum. Les valeurs réelles sont conservées dans le texte et seul le remplissage est borné entre 0 et 100 %.

Les hooks de sélection, de cycle du canvas et de mise à jour des acteurs/tokens actualisent uniquement les données de la barre. Les changements d'objets et d'effets de l'acteur sélectionné sont également pris en compte pour les statistiques préparées. Aucune zone DEF ou mouvement n'est ajoutée.

Les réglages du module proposent les tailles S/M/L/XL (M par défaut) et le verrouillage. Le rouage verrouille la position ; le portrait permet le déplacement lorsque la barre est déverrouillée. La valise et le personnage restent sans action ; les boutons 1/2/3 sélectionnent le preset de l'acteur sans ouvrir de volet. Taille, position et verrouillage restent enregistrés par utilisateur. Sans position enregistrée, la barre apparaît à 40 px des bords gauche et inférieur. Les petites fenêtres réduisent automatiquement la barre pour la conserver à l’écran.

L'étoile ouvre la feuille existante de l'acteur sélectionné (droit Observateur). Le trèfle appelle `token.actor.system.rollFortune()` pour un personnage propriétaire ou un MJ, comme la feuille CO2. Les valeurs numériques PV/PM ouvrent un dialogue Foundry `DialogV2` non modal, sans modifier la géométrie de Prism. Une saisie entière entre zéro et le maximum actuel est persistée par `actor.update`, uniquement sur `system.attributes.hp.value` ou `system.resources.mana.value`. Les validations et effets de bord natifs CO2 sont ainsi conservés, notamment les statuts gérés par `CharacterData._preUpdate`. La sélection, les droits et le maximum sont revérifiés après la saisie ; une sélection quittée n'est pas modifiée. La synchronisation continue de passer par les hooks existants.

La tasse et le lit recherchent les entrées uniques `fastRest` et `fullRest` de `game.system.CONST.restActions`, puis appellent `rest.handler(token.actor)`, comme `COBaseActorSheet.#onUseRest`. Ces identifiants et les labels `CO.ui.fastRest` / `CO.ui.fullRest` ont été vérifiés dans le module installé `cof2-base/cof-base.mjs` ; ses handlers délèguent à `actor.system.useRecovery(false/true)`. Prism conserve donc les confirmations, notifications et hooks du système et des modules de contenu. Aucun handler n'est créé par Prism : registre absent, ambigu ou incomplet, droits insuffisants ou ressources manquantes désactivent la commande avec une infobulle localisée. Les actions en cours et les clics de repos rapprochés sont protégés contre les doubles déclenchements.

Configuration partagée : `flags.co2prism` expose logiquement cette structure (aucune donnée CO2 n'y est copiée) :

```js
{
  activePreset: 1,
  panels: { combat: false, competences: false, equipements: false },
  presets: { 1: { slots: {} }, 2: { slots: {} }, 3: { slots: {} } }
}
```

`readConfiguration(actor)` normalise les flags absents, partiels ou mal formés et retourne trois ensembles de slots indépendants. Ces valeurs par défaut ne sont jamais écrites au chargement. Les boutons de preset appellent `setActivePreset(1/2/3)` ; `setPanelState("combat"/"competences"/"equipements", boolean)` prépare la persistance des volets indépendants sans créer de volet ni brancher valise/personnage. Les slots restent vides par défaut, sans nombre imposé, et aucun éditeur de raccourcis n'est ajouté.

Les écritures attendent `token.actor.setFlag("co2prism", chemin, valeur)` sur le seul champ modifié (`activePreset` ou `panels.<nom>`). Elles sont sérialisées par acteur, capturent l'acteur du clic et revérifient les droits Owner/MJ avant persistance. Une sélection différente ne reçoit pas une écriture en attente. Les autres flags, les champs inconnus et le contenu de chaque preset sont préservés. La configuration est relue dans le rafraîchissement existant et dans les hooks `updateActor`/`updateToken`, y compris pour les changements de flags distants ; ces lectures ne provoquent pas d'écriture. Deux utilisateurs partagent les flags de l'acteur ; sur un même champ, la dernière mise à jour native fait foi.

Tokens liés : les flags appartiennent à l'acteur du monde. Tokens non liés : l'API est appelée sur l'acteur synthétique, jamais sur `baseActor`. Le code Foundry v14 local (`ClientDatabaseBackend.#adjustActorDeltaRequest` et `ActorDelta._onUpdate`) confirme la traduction des écritures vers l'ActorDelta du token et l'émission de `updateActor`. L'acteur synthétique hérite des données de base selon les règles Foundry tant qu'elles ne sont pas surchargées dans son delta. Les tests simulent l'isolation de l'écriture ; la persistance réelle après rechargement, la conversion lié/non lié et la synchronisation entre deux clients restent à valider dans un monde actif.

Installation : dossier `Data/modules/co2prism/`. Auteur : Alchimiste36.

Tests simulés : `node --test tests/actor-bar.test.mjs`.

Étape 04 : la racine `#co2prism-bar` reste directement dans `body`, avec une boîte fixe aux dimensions de Prism. Les surfaces transparentes laissent passer les événements ; le portrait, les jauges et le rouage conservent leurs interactions. Une position ramenée dans l'écran après changement de taille est aussi enregistrée. Seul le pointeur ayant commencé le déplacement peut le terminer ; l'enregistrement reste effectué à la fin du déplacement.

Contrôle navigateur : `node --test tests/*.test.mjs`. Le test Edge utilise le CSS local de Foundry, sans ouvrir ni modifier un monde. Les chemins peuvent être fournis par `CO2PRISM_EDGE` et `CO2PRISM_FOUNDRY_CSS` ; ce test est ignoré si ces fichiers sont absents. Dimensions mesurées S/M/L/XL : 300 × 213,39 ; 430 × 305,86 ; 600 × 426,78 ; 780 × 554,83 px. Les points testés autour de Prism et dans ses coins transparents atteignent le board natif. Le `canvas#board` plein écran est créé par Foundry et reste intact. Le défaut signalé n'a pas été reproduit dans ce contrôle isolé ; sa cause dans le monde actif reste à confirmer sur place.

À valider dans Foundry : sélection de personnages et rencontres, token non lié, droits d'un joueur Observateur et propriétaire, ouverture de feuille, jet de chance natif, édition PV/PM dans les deux sens et statuts CO2, confirmations et effets des repos avec le contenu actif, changement de scène, rendu des quatre tailles, déplacement, restauration après rechargement et absence d'erreurs dans la console. Les tests simulent les API et les handlers ; ils ne remplacent pas ces vérifications dans un monde actif. Aucune version n'est encore déclarée comme vérifiée.
