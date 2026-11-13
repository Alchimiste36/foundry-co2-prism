# CO2 Prism — Instructions de développement pour Codex

## Contexte du projet
- **Nom du module :** CO2 Prism
- **Identifiant du module :** `co2prism`
- **Environnement cible :** Foundry VTT v14
- **Système de jeu :** Chroniques Oubliées 2 (CO2), dans un premier temps pour l'univers Fantasy.
- Le module doit rester spécifique à CO2. Ne pas ajouter de compatibilité avec d'autres systèmes sans demande explicite.

## Règles de développement

### 1. Préfixes CSS
- Toutes les classes CSS créées pour le module doivent commencer par `co2prism` (par exemple `.co2prism-bar`, `.co2prism-action`).
- Appliquer également ce préfixe aux identifiants HTML et aux noms d'animations CSS propres au module.
- Éviter les sélecteurs globaux qui pourraient modifier l'apparence de Foundry ou d'autres modules.

### 2. Commentaires
- Rédiger les commentaires en **français**.
- Utiliser des commentaires courts, simples et utiles.
- Commenter principalement les sections importantes et les comportements qui ne sont pas évidents.
- Éviter les commentaires répétitifs ou les explications inutilement longues dans les fichiers CSS, JS et HTML/Handlebars.

### 3. Réutilisation du code
- **Toujours examiner les fichiers concernés avant de modifier le code.**
- Rechercher les fonctions, composants et mécanismes existants avant d'en créer de nouveaux.
- Privilégier la réutilisation ou l'adaptation d'une fonction existante lorsqu'elle répond déjà au besoin.
- Éviter les doublons, les fonctions superflues et les abstractions prématurées.
- Pour les actions liées à CO2, examiner les mécanismes du système avant de reproduire leur logique.

### 4. Localisation
- Utiliser autant que possible les clés de localisation Foundry pour les textes visibles et les info-bulles.
- Éviter les textes d'interface codés directement dans les fichiers JS ou les templates.
- Prévoir au minimum des entrées françaises, avec des clés cohérentes et regroupées sous l'espace `CO2PRISM`.
- Ne pas localiser les identifiants techniques ni les valeurs qui ne sont pas destinées à l'affichage.

### 5. Progression par petites étapes
- Développer uniquement la fonctionnalité demandée à chaque étape.
- Préférer des modifications petites, ciblées et vérifiables.
- Ne pas anticiper plusieurs fonctionnalités futures ou développer de nombreuses fonctions en une seule intervention.
- Vérifier le fonctionnement de l'étape en cours avant de passer à la suivante.
- En cas d'ambiguïté importante, demander une précision plutôt que d'inventer un comportement.

### 6. Simplicité et compatibilité
- Privilégier un code lisible, direct et facile à maintenir.
- Respecter les API et conventions de Foundry VTT v14.
- Éviter les méthodes obsolètes et signaler toute dépendance à une API plus ancienne.
- Respecter les données et les permissions du système CO2.
- Ne pas modifier directement les fichiers du système CO2 : les adaptations doivent rester dans le module.

## Méthode de travail attendue
1. Examiner les fichiers et le fonctionnement existants concernés par la demande.
2. Identifier la solution la plus simple, en réutilisant le code disponible.
3. Modifier uniquement les éléments nécessaires à l'étape demandée.
4. Effectuer les vérifications possibles et signaler celles qui n'ont pas pu être réalisées.
5. Résumer brièvement les fichiers modifiés et les points restant à tester.

**Principe général :** analyser avant de coder, réutiliser avant de créer, avancer une fonctionnalité à la fois.
