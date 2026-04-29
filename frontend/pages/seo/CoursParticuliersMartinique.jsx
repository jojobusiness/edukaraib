import React from 'react';
import SEOLocalPage from '../SEOLocalPage';

export default function CoursParticuliersMartinique() {
  return (
    <SEOLocalPage
      title="Cours particuliers en Martinique — Soutien scolaire en ligne"
      description="Cours particuliers en Martinique : trouvez un professeur certifié pour toutes les matières. Visio, paiement sécurisé en 3x, packs 5h et 10h. EduKaraib, la plateforme scolaire des Antilles."
      urlPath="/cours-particuliers-martinique"
      heading="Cours particuliers en Martinique"
      subheading="Trouvez le professeur idéal pour votre enfant en Martinique — toutes matières, tous niveaux, en visio."
      island="Martinique"
      subject={null}
      islandDescription="En Martinique, trouver un bon professeur particulier peut être difficile, surtout dans les zones rurales loin de Fort-de-France. EduKaraib résout ce problème en proposant une plateforme de mise en relation entre familles martiniquaises et professeurs qualifiés, avec des cours dispensés entièrement en visioconférence. Que vous habitiez au François, à Sainte-Marie, à Rivière-Pilote ou au Marin, vos enfants peuvent bénéficier des meilleurs professeurs de l'île depuis chez vous. Notre plateforme couvre toutes les matières scolaires, de la 6ème au Baccalauréat, avec des professeurs certifiés et évalués par les familles."
      faq={[
        {
          q: 'Combien coûtent les cours particuliers en Martinique ?',
          a: "Les tarifs varient entre 20€ et 50€/h selon la matière et le niveau du professeur. La plateforme ajoute 10€/h de frais de service. Le crédit d'impôt français permet de récupérer 50% des frais payés — soit un coût réel divisé par deux pour les foyers imposables.",
        },
        {
          q: 'Peut-on trouver des cours particuliers pour le primaire en Martinique ?',
          a: "Oui, EduKaraib propose des cours pour tous les niveaux : CP, CE1, CE2, CM1, CM2, 6ème, 5ème, 4ème, 3ème, Seconde, Première et Terminale. Certains professeurs se spécialisent même dans l'aide aux élèves présentant des difficultés d'apprentissage (dyslexie, TDAH).",
        },
        {
          q: 'Les cours particuliers en ligne sont-ils aussi efficaces qu\'en présentiel en Martinique ?',
          a: "Selon de nombreuses études, les cours en visio sont aussi efficaces que les cours en présentiel lorsqu'ils sont bien préparés. L'avantage : pas de transport, moins de fatigue pour l'élève, et la possibilité de choisir parmi un plus grand nombre de professeurs qualifiés.",
        },
        {
          q: 'Comment choisir le bon professeur particulier pour mon enfant en Martinique ?',
          a: "Sur EduKaraib, consultez le profil de chaque professeur : formation, matières enseignées, tarif et avis laissés par les familles. Vous pouvez contacter le professeur avant de réserver pour vous assurer de la compatibilité avec votre enfant.",
        },
        {
          q: 'Peut-on payer les cours particuliers en plusieurs fois en Martinique ?',
          a: "Oui. EduKaraib propose le paiement en 3 fois pour les packs de cours. C'est particulièrement utile pour les packs 10h dont le montant peut dépasser 300€.",
        },
      ]}
    />
  );
}
