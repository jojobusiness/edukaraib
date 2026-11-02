# PLAN — Préparer le programme partenaires aux créateurs de contenu · 02/11/2026

> **Demande de Joseph (02/11)** : « regarde plutôt la partie influenceur en profondeur et arrange pour préparer le terrain ».
> **Cadre** : le prof et les familles discutent ensemble, Joseph n'intervient pas dans la mise en relation.
> **Vocabulaire** : aucun texte visible ne dit « influenceur » (règle du 15/09) : on écrit « créateur ».

## 1. Ce qui tient (relu, rien à changer)
Remise et reversement plafonnés à la commission, prof jamais touché, rattachement de la famille au 1ᵉʳ paiement, transfert Stripe Connect 7 jours après, remboursement déduit, code personnel refusé, code refusé non bloquant.

## 2. Ce qui faisait perdre de l'argent ou des créateurs
| Trou | Conséquence | Correctif |
|---|---|---|
| Le code n'était lu que sur `/bac` et `/rentree` | Lien vers l'accueil ou une fiche prof : pas de remise, créateur non payé | Lecture sur toutes les pages (`capterCodePartenaire`) |
| Le code vivait 14 jours dans UN navigateur | Inscription dans TikTok, paiement plus tard dans Safari : vente perdue pour le créateur | Code gardé sur le compte (`acquisition.code`, `code_campagne`), le paiement le retrouve côté serveur. Durée portée à 90 jours |
| Une 1ʳᵉ source déjà connue écrasait le code | Visite passée par Facebook, puis lien du créateur : code absent du compte | Le code est enregistré indépendamment de la source |
| Lien long, inutilisable à l'oral ou en bio | Les vidéos n'ont souvent pas de lien cliquable | `edukaraib.com/p/CODE` |
| Tout était écrit pour une association | « Votre structure », « Notre association a noué un partenariat » dans le texte d'un créateur | Parcours `/createurs`, textes et mail adaptés, légende prête à poster |
| Aucune mesure avant le paiement | Impossible de distinguer un créateur sans clics d'un créateur dont les clics ne convertissent pas | Clics et inscrits par code, dans l'espace du créateur et dans l'admin |
| « Continuer avec Google » dans TikTok et Instagram | Google refuse ces navigateurs intégrés : erreur en pleine inscription | Bouton masqué dans ces navigateurs, inscription par e-mail |

## 3. Limites assumées
- Clics : un par navigateur et par 24 h, sans donnée personnelle. Ordre de grandeur, pas une facturation.
- Inscrits : un nombre seulement, jamais d'identité (familles, mineurs).

## 4. Preuve
- Vitest : capture du code, repli serveur, stats, navigateur intégré.
- Prod : créateur de test créé par la vraie API, lien court, clic, famille inscrite, session Stripe réelle créée puis expirée, sans paiement.
- ⚠️ Non prouvé sans vrai paiement : le crédit du reversement par le webhook puis le transfert du cron (couverts seulement par des tests unitaires).

## 5. Résultat (à remplir)
- RÉSULTAT : …
