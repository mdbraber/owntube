---
name: design-et-qualite
description: Applique les standards de design UI, nommage, commentaires et qualité de code OwnTube (Next.js, React, tRPC, Tailwind). Use when implementing features, creating components, refactoring UI, or when the user mentions design, qualité, conventions, or nommage on OwnTube.
---

# Design et qualité de code — OwnTube

## Instructions

Avant toute modification UI ou logique métier :

1. Parcourir les composants et helpers existants dans le périmètre concerné.
2. Réutiliser les abstractions en place ; n’introduire du nouveau que si nécessaire.
3. Respecter les sections ci-dessous (texte projet) et la section **Spécificités OwnTube**.
4. Vérifier avec `pnpm lint`, `pnpm typecheck` et les tests concernés avant de conclure.

---

## Langue De L’interface

- **Texte UI en anglais** : boutons, navigation, messages, placeholders, aria-labels, toasts, états vides (`Reopen`, `Close`, `Settings` — pas de francisation ad hoc).
- Exceptions : marque **`owntube`**, contenu utilisateur/upstream (titres, descriptions), docs internes et commentaires de code.

## Design Et Composants

- Avant d'ajouter une interface, un composant ou un comportement visuel, vérifier ce qui existe déjà dans le projet.
- Réutiliser les composants, styles, helpers et conventions en place dès que possible.
- Créer un composant dédié lorsqu'un élément ou comportement est utilisé plusieurs fois.
- Garder les composants simples, composables et cohérents avec le design existant.
- Ne pas introduire de nouvelle convention visuelle sans raison claire.

## Nommage

- Toutes les variables, propriétés, méthodes et classes doivent avoir des noms logiques, lisibles et explicites.
- Éviter les abréviations ambiguës, les noms génériques et les noms sans intention métier.
- Préférer un nom plus long mais clair à un nom court qui demande du contexte.

```typescript
// Mauvais
const d = video.publishedAt;

// Bon
const datePublicationVideo = video.publishedAt;
```

## Commentaires

- Les commentaires doivent être clairs, uniformes et strictement descriptifs du code.
- Ne jamais laisser de commentaires de suggestion, de conversation ou de génération IA.
- Ajouter un commentaire uniquement lorsqu'il clarifie une règle métier, une contrainte technique ou un choix non évident.

```typescript
// Mauvais
// Tu veux que je change ça plus tard ?

// Bon
// publishedAt est en secondes Unix ; Piped/Invidious ne garantissent pas toujours publishedText.
```

## Qualité Attendue

- Le code rendu doit être propre, cohérent, maintenable et prêt pour revue.
- Respecter les conventions du projet (Biome, TypeScript strict, patterns Next.js/tRPC) et les standards locaux.
- Éviter les placeholders, le code mort, les duplications inutiles et les changements hors périmètre.

---

## Spécificités OwnTube

### Stack et outils

| Domaine | Emplacement / outil |
|---------|---------------------|
| Pages App Router | `src/app/` |
| Composants UI | `src/components/{domaine}/` ; primitives `src/components/ui/` |
| Client tRPC | hooks générés côté app ; routers `src/server/trpc/routers/` |
| Base de données | Drizzle + SQLite — `src/server/db/` |
| Helpers partagés | `src/lib/` |
| Styles globaux | `src/app/globals.css` (variables HSL `--primary`, `--muted`, etc.) |
| Classes Tailwind | `cn()` depuis `@/lib/utils` |
| Lint / format | Biome — `pnpm lint`, `pnpm format` |
| Tests unitaires | Vitest — fichiers `*.test.ts` à côté du module |
| Package manager | `pnpm` (Node ≥ 22) |

### Organisation des composants

- **`shell/`** — layout, sidebar, topbar, recherche, thème
- **`player/`** — lecteur Vidstack, file d’attente, mini-player
- **`videos/`**, **`watch/`**, **`shorts/`** — cartes, grilles, page watch, flux shorts
- **`channel/`**, **`subscriptions/`**, **`playlists/`**, **`history/`**, **`search/`**
- **`auth/`**, **`settings/`**, **`onboarding/`**
- **`ui/`** — Button, Card, Input (pattern shadcn + CVA)

Ne pas dupliquer un composant domaine existant (ex. `VideoCard`, `AppShell`, `VideoPlayer`) : étendre ou composer.

### Conventions de fichiers

- Fichiers composants : `kebab-case.tsx` (ex. `video-card-actions-menu.tsx`)
- Export principal : fonction nommée en `PascalCase` (ex. `export function VideoCard`)
- Hooks React : `use-*.ts` dans `src/hooks/` ou colocalisé si très spécifique
- Types props : `{NomComposant}Props` dans le même fichier
- Imports absolus via `@/` uniquement (pas de chemins relatifs profonds `../../`)

### UI et thème

- Utiliser les composants `src/components/ui/` et les tokens CSS existants (`hsl(var(--primary))`, etc.)
- Tailwind 4 ; ne pas ajouter de fichier CSS module sauf besoin documenté
- Lecteur vidéo : `@vidstack/react` — suivre les patterns de `src/components/player/video-player.tsx`
- Thème clair/sombre : variables dans `globals.css` ; synchro via `theme-store` / `ThemeSync`

### Serveur et données

- Nouvelles procédures tRPC : router dédié ou extension d’un router existant dans `src/server/trpc/routers/`
- Schémas Zod pour les entrées ; erreurs métier via helpers serveur existants
- Migrations Drizzle : `pnpm db:generate` puis `pnpm db:migrate` — ne pas modifier le SQL généré à la main sans raison
- Upstream Piped/Invidious : respecter les abstractions dans `src/lib/` (proxy, playback, headers)

### Tests et CI

- Logique non triviale dans `src/lib/` ou `src/server/` : test Vitest colocalisé
- CI exécute typecheck, tests et build — faire tourner localement avant PR
- Pas de tests qui mockent l’évident ou ne font qu’asserter des constantes

### Périmètre des changements

- Une PR / tâche = un objectif clair ; pas de refonte transversale non demandée
- Ne pas committer de secrets (`.env`, clés) ; voir `env.unraid.example` pour les variables attendues

## Checklist avant livraison

```
- [ ] Composants/helpers existants réutilisés ou étendus
- [ ] Noms explicites ; fichiers kebab-case, exports PascalCase
- [ ] Commentaires uniquement si nécessaires et descriptifs
- [ ] pnpm lint && pnpm typecheck OK
- [ ] Tests ajoutés/mis à jour si logique métier touchée
- [ ] Aucun changement hors périmètre de la demande
```
