# CO2 Prism

Module pour Foundry VTT v14 et Chroniques Oubliées 2 (`co2`), initialement pour Fantasy.

Étape 02 : barre reliée à l'acteur du token contrôlé, sans actions de jeu. Portrait et quatre jauges dynamiques en HTML/CSS, avec les icônes Font Awesome Solid de Foundry.

Une sélection unique affiche les données préparées de `token.actor`, à condition de disposer du droit Observateur. Sans sélection, en sélection multiple ou sans autorisation, la barre affiche un portrait temporaire et des tirets. Les rencontres affichent les PV et les seules ressources réellement disponibles. Un maximum absent, non fini ou inférieur ou égal à zéro est remplacé par un tiret ; le remplissage reste vide, sans inventer de maximum. Les valeurs réelles sont conservées dans le texte et seul le remplissage est borné entre 0 et 100 %.

Les hooks de sélection, de cycle du canvas et de mise à jour des acteurs/tokens actualisent uniquement les données de la barre. Les changements d'objets et d'effets de l'acteur sélectionné sont également pris en compte pour les statistiques préparées. Aucune zone DEF ou mouvement n'est ajoutée.

Les réglages du module proposent les tailles S/M/L/XL (M par défaut) et le verrouillage. La petite poignée permet le déplacement lorsque la barre est déverrouillée. Taille, position et verrouillage sont enregistrés par utilisateur. Sans position enregistrée, la barre apparaît à 40 px des bords gauche et inférieur. Les petites fenêtres réduisent automatiquement la barre pour la conserver à l’écran.

Installation : dossier `Data/modules/co2prism/`. Auteur : Alchimiste36.

Tests simulés : `node --test tests/actor-bar.test.mjs`.

À valider dans Foundry : sélection de personnages et rencontres, token non lié, mise à jour depuis les feuilles CO2, changement de scène, rendu des quatre tailles, déplacement, restauration après rechargement et absence d'erreurs dans la console. Aucune version n'est encore déclarée comme vérifiée.
