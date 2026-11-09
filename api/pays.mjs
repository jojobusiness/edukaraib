// GET /api/pays → { pays: 'GF' } (09/11/2026)
// Pays de connexion, d'après l'adresse IP (en-tête Vercel). Sert à préremplir
// l'indicatif du téléphone à l'inscription et à savoir d'où vient un inscrit.
// Anonyme : aucune IP n'est renvoyée ni stockée ici.
import { paysDepuisEntete } from './_telephone.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ pays: paysDepuisEntete(req.headers['x-vercel-ip-country']) });
}
