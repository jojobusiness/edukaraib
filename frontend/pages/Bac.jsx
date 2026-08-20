import CampaignLanding from '../components/CampaignLanding';
import { BAC_CAMPAIGN } from '../config/campaigns';

/* Landing campagne bac (`/bac`, alias `/rattrapage`).
   Le rendu vit dans `components/CampaignLanding.jsx`, partagé avec `/rentree`.
   Le contenu (heroes par phase, packs, matières, voix) est dans
   `config/campaigns.js`. */
export default function Bac() {
  return <CampaignLanding config={BAC_CAMPAIGN} />;
}
