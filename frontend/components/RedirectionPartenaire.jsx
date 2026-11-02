import { Navigate, useParams } from 'react-router-dom';

// Lien court d'un partenaire : edukaraib.com/p/CODE, assez court pour une bio ou
// pour être dit à l'oral dans une vidéo (02/11/2026). Le code est déjà capté
// au démarrage du site (lib/bacCampaign.js).
export default function RedirectionPartenaire() {
  const { code } = useParams();
  return <Navigate to={`/rentree?code=${encodeURIComponent(code || '')}`} replace />;
}
