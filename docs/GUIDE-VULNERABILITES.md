<!-- lang: fr; label: Guide Vibeproof -->
# Guide des vulnérabilités

Les 12 types de faiblesses que Vibeproof recherche dans les applications « vibe-codées » : ce que c'est, pourquoi c'est grave, comment les scanner et comment les vérifier à la main.

| Élément | Détail |
|---|---|
| Scans | Scan du dépôt : un lien vers un dépôt public ou un dossier de projet. Scan en ligne : l'URL d'un site qui vous appartient (la propriété est vérifiée d'abord). |
| Lancement | npm run dashboard, puis collez un lien, un dossier ou une URL. En ligne de commande : vibeproof repo <lien ou dossier>, vibeproof web <url> |
| Règle | Ne scannez que vos propres applications ou celles pour lesquelles vous avez une autorisation écrite. |
| Version | 1.0, 15 novembre 2026 |

## 1. Secrets dans le code et l'historique git

- Ce que c'est : clés privées, clés de fournisseurs (Stripe, AWS, GitHub, OpenAI...) ou mots de passe écrits directement dans le code, ou commités puis supprimés.
- Pourquoi c'est grave : toute personne qui lit le code ou l'historique peut les utiliser. Supprimer la ligne ne la retire pas de l'historique git.
- Scan : scan du dépôt (lit chaque fichier et chaque ancien commit). Le scan en ligne trouve aussi les clés livrées dans le JavaScript. Règles VP-SEC-001, VP-SEC-002, VP-SEC-003.
- À la main : cherchez dans le projet sk_live_, AKIA, ghp_, sk-proj- et « BEGIN PRIVATE KEY », puis les mêmes chaînes dans git log -p.

## 2. Clé privilégiée Supabase exposée

- Ce que c'est : la clé service_role (ou une clé sb_secret_), qui contourne toutes les règles de la base, placée dans le code du navigateur ou dans un fichier commité.
- Pourquoi c'est grave : son détenteur peut lire, modifier et supprimer toutes les tables. C'est le constat le plus grave.
- Scan : les deux scans. Le scan du dépôt décode chaque clé trouvée et signale les clés service_role utilisées hors du code serveur ; le scan en ligne les trouve dans le JavaScript livré. Règles VP-DB-006, VP-DB-004.
- À la main : dans les DevTools du navigateur (onglet Sources), cherchez service_role et sb_secret_ dans les scripts chargés. Collez toute clé eyJ... dans un décodeur JWT : le rôle doit être anon.

## 3. Secrets dans des variables publiques et fichiers .env commités

- Ce que c'est : un secret stocké dans une variable à préfixe public (NEXT_PUBLIC_, VITE_, REACT_APP_...), que la compilation copie dans le code du navigateur ; ou un fichier .env commité dans git.
- Pourquoi c'est grave : chaque visiteur télécharge la valeur ; un .env commité expose tous ses secrets à quiconque a accès au dépôt.
- Scan : scan du dépôt. Règles VP-ENV-002, VP-ENV-001.
- À la main : lancez git ls-files | grep .env (seul .env.example doit apparaître). Vérifiez qu'aucune variable à préfixe public ne contient SECRET, SERVICE, ADMIN, PRIVATE, PASSWORD ou TOKEN.

## 4. Tables de base de données ouvertes à tous

- Ce que c'est : une table Supabase sans row level security (RLS), une politique dont la condition est true, ou une politique qui laisse tout utilisateur connecté modifier toutes les lignes.
- Pourquoi c'est grave : la clé anon publique, présente dans le navigateur de chaque visiteur, peut alors lire ou modifier les données directement.
- Scan : le scan du dépôt lit les migrations SQL (VP-DB-001, VP-DB-002). Le scan en ligne demande une ligne de chaque table à la vraie API avec la clé anon et signale les tables qui répondent (VP-DB-005), y compris celles créées dans le tableau de bord sans migration.
- À la main : dans le tableau de bord Supabase, Authentication > Policies : chaque table doit avoir RLS activé et des politiques qui utilisent auth.uid().

## 5. Schéma de l'API visible par tous

- Ce que c'est : la racine REST de Supabase (/rest/v1/) liste toutes les tables, colonnes et fonctions à la clé publique.
- Pourquoi c'est grave : cela donne à un attaquant la carte de ce qu'il peut sonder, y compris des tables que l'application ne mentionne jamais.
- Scan : scan en ligne. Règle VP-DB-009.
- À la main : ouvrez https://<projet>.supabase.co/rest/v1/ avec la clé anon dans l'en-tête apikey et regardez si une liste de chemins s'affiche.

## 6. Buckets de stockage et règles de fichiers

- Ce que c'est : un bucket public qui contient des fichiers privés, ou une politique de stockage qui permet aux anonymes d'envoyer, d'écraser, de supprimer ou de lister des fichiers.
- Pourquoi c'est grave : des documents privés deviennent téléchargeables, et n'importe qui peut remplir ou vider le bucket.
- Scan : scan du dépôt pour les politiques et la configuration des buckets (VP-STO-001, VP-STO-002) ; le scan en ligne vérifie si les buckets nommés dans le code sont publics (VP-STO-002).
- À la main : tableau de bord Supabase, Storage : vérifiez quels buckets sont publics et que les politiques comparent le dossier à auth.uid().

## 7. Fonctions de base de données privilégiées

- Ce que c'est : une fonction security definer (exécutée avec les droits de son propriétaire, sans RLS) que les anonymes peuvent encore appeler via /rest/v1/rpc, ou qui n'a pas de search_path fixe.
- Pourquoi c'est grave : n'importe quel visiteur peut déclencher des actions privilégiées, comme supprimer des utilisateurs.
- Scan : scan du dépôt (migrations SQL). Règles VP-DB-007, VP-DB-008.
- À la main : cherchez security definer dans les migrations ; chaque fonction concernée doit avoir revoke execute ... from public, anon et set search_path = ''.

## 8. Edge functions sans authentification

- Ce que c'est : une edge function Supabase qui utilise la clé service_role sans vérifier qui l'appelle, ou dont la vérification JWT est désactivée (verify_jwt = false) sans contrôle propre.
- Pourquoi c'est grave : n'importe qui sur internet peut l'appeler avec tous les droits sur la base.
- Scan : scan du dépôt (supabase/functions et supabase/config.toml). Règles VP-FN-001, VP-FN-002.
- À la main : chaque fonction doit appeler auth.getUser() (ou vérifier la signature d'un webhook) avant toute action.

## 9. Règles de sécurité Firebase

- Ce que c'est : des règles Firestore, Storage ou Realtime Database ouvertes à tous, encore en « mode test » (ouvertes jusqu'à une date), ou dont la seule condition est d'être connecté.
- Pourquoi c'est grave : l'identifiant du projet Firebase est public dans toute application web, et n'importe qui peut créer un compte.
- Scan : le scan du dépôt lit firestore.rules, storage.rules et database.rules.json (VP-FB-001, VP-FB-002). Le scan en ligne essaie de lire la base sans connexion (VP-FB-003).
- À la main : dans la console Firebase, ouvrez l'onglet Règles de chaque produit : cherchez if true, request.time < timestamp.date(...), ou request.auth != null seul.

## 10. Fichiers que l'hébergeur ne devrait jamais servir

- Ce que c'est : l'hébergeur publie /.env, /.git, ou le code source original via des source maps publiques.
- Pourquoi c'est grave : les secrets, le dépôt complet ou le code lisible sont téléchargeables par tous.
- Scan : scan en ligne. Règles VP-WEB-006, VP-WEB-005.
- À la main : ouvrez https://votre-site/.env et https://votre-site/.git/HEAD (les deux doivent échouer), et cherchez des fichiers .tsx originaux dans l'onglet Sources des DevTools.

## 11. En-têtes de sécurité manquants

- Ce que c'est : pas de Content-Security-Policy, de HSTS, de protection contre le clickjacking ni d'en-tête nosniff.
- Pourquoi c'est grave : les scripts injectés ne sont pas limités, d'autres sites peuvent intégrer le vôtre dans un cadre, et le navigateur peut d'abord se connecter en HTTP non chiffré.
- Scan : scan en ligne. Règles VP-WEB-001 à VP-WEB-004.
- À la main : DevTools, onglet Réseau, cliquez sur la requête de la page et lisez les en-têtes de réponse.

## 12. Dépendances

- Ce que c'est : pas de fichier de verrouillage (lockfile), ou des dépendances de production avec des vulnérabilités connues critiques ou élevées.
- Pourquoi c'est grave : les installations ne sont pas reproductibles, et des failles connues peuvent s'appliquer à l'application.
- Scan : scan du dépôt (VP-ENV-003) ; ajoutez --npm-audit en ligne de commande pour VP-DEP-001.
- À la main : commitez le lockfile et lancez npm audit --omit=dev.

## Corriger ce que vous trouvez

Chaque constat du tableau de bord a un bouton Copy fix prompt : collez le texte dans votre agent de code (Claude Code, Cursor, Copilot...). Faites vous-même la rotation de toute clé exposée dans le tableau de bord du fournisseur ; la retirer du code ne suffit pas.
