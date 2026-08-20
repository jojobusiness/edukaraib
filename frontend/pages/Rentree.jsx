import CampaignLanding from '../components/CampaignLanding';
import { RENTREE_CAMPAIGN } from '../config/campaigns';

/* Landing campagne rentrée (`/rentree`).
   Même moteur que `/bac`, contenu et voix différents : ici le payeur est le
   parent (vouvoiement) et le pack mis en avant est le 10h — cf.
   `config/campaigns.js`. */
export default function Rentree() {
  return <CampaignLanding config={RENTREE_CAMPAIGN} />;
}
