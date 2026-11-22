# CO2 Prism

CO2 Prism affiche sur la scène le portrait, les ressources et les commandes de l’acteur suivi dans un monde Chroniques Oubliées 2. Depuis la barre, on peut accéder aux compétences, aux équipements, aux voies et capacités, ainsi qu’aux raccourcis de combat.

## Installer et activer

1. Utiliser **Foundry VTT v14** avec un monde **Chroniques Oubliées 2** (système `co2`).
2. Placer le dossier du module dans `Data/modules/co2prism/` du répertoire de données Foundry. Le fichier [module.json](module.json) doit se trouver directement dans ce dossier.
3. Ouvrir le monde, puis activer **CO2 Prism** dans la gestion des modules.

## Utiliser Prism

- Sélectionner un seul token observable. Un joueur sans token contrôlé peut retrouver son personnage assigné. La gemme des contrôles de tokens permet d’afficher ou de masquer Prism.
- Déverrouiller Prism avec l’engrenage pour le déplacer depuis le portrait, régler sa taille avec le curseur ou modifier les raccourcis. La taille est enregistrée par utilisateur au verrouillage. Les anciennes préférences S/M/L/XL sont encore lues.
- Les commandes autour du portrait ouvrent les volets Compétences, Équipements, Voies & Capacités et Combat. Le volet Combat regroupe les défenses, les carrés des mains et leurs presets. Les miniatures au bas du portrait représentent les cibles de l’utilisateur courant. Un clic droit sur une miniature retire cette cible.
- **Budget d’action** et **Suivi du déplacement** sont deux préférences utilisateur distinctes. Les deux proposent **Toujours**, **Uniquement en combat** et **Jamais**. En mode combat, le suivi exige que le token sélectionné participe au combat actif et démarré. Le rectangle Déplacement reste disponible dans le volet Combat lorsque le suivi supérieur est masqué.
- Quand le suivi est actif, le panneau compte les cases à partir de la position de départ de la session. La Zone tactique affiche une portée calculée au moment de son activation. Valider un trajet débite une action M lorsque le budget s’applique.

## Vérifier le module

Depuis la racine du dépôt, lancer la suite avec Node.js :

```sh
node --test --test-concurrency=1 tests/*.test.mjs
```

Le test navigateur utilise Edge et le CSS d’une installation locale de Foundry. Les chemins peuvent être configurés avec `CO2PRISM_EDGE` et `CO2PRISM_FOUNDRY_CSS`. Les tests du contrat de mouvement lisent le script local du Core via `CO2PRISM_FOUNDRY_SCRIPT`. Un test d’intégration des mains lit également les sources du système CO2 installé à côté du module. La suite ignore les contrôles qui nécessitent des fichiers locaux absents. [Test navigateur](tests/browser-layout.test.mjs) · [Contrat natif](tests/native-movement-contract.test.mjs)

La [sonde manuelle de déplacement](tests/manual/movement-zone-probe.md) s’utilise dans un monde Foundry. Elle cite une scène exportée qui doit être fournie séparément.

## Maintenance et références

- Le [journal historique](HISTORIQUE.md) conserve l’ancien README avec ses résultats et limites à la date de chaque étape.
- Les [consignes de développement](CO2_Prism_Instructions_Codex.md) décrivent les conventions du dépôt.
- Le [benchmark de Zone tactique](benchmarks/movement-zones.mjs) s’exécute avec `node benchmarks/movement-zones.mjs` et réécrit le [rapport de comparaison à portée égale](benchmarks/movement-zones-single-action-results.json). Les scénarios sont simulés. Le [moteur de référence](benchmarks/reference/movement-zones-step1.mjs) sert aussi aux tests de régression. L’[ancien rapport](benchmarks/movement-zones-results.json) conserve les mesures des scénarios historiques.

Pour une archive de partage, exclure le répertoire `.git/` du contenu de l’archive et conserver le dossier `co2prism/` à sa racine.
