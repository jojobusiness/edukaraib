import React from 'react';
import SEOLocalPage from '../SEOLocalPage';

export default function CoursMathsMartinique() {
  return (
    <SEOLocalPage
      title="Cours de Maths en Martinique en ligne"
      description="Trouvez un professeur de mathématiques en Martinique. Cours particuliers en visio, paiement sécurisé, profs certifiés. Pack 5h et 10h disponibles."
      urlPath="/cours-maths-martinique"
      heading="Cours de Maths en Martinique"
      subheading="Des professeurs certifiés, des cours en visio depuis chez vous. Paiement sécurisé en 3 fois."
      island="Martinique"
      subject="Mathématiques"
      islandDescription="En Martinique, les mathématiques sont souvent la matière la plus redoutée au collège et au lycée. Pourtant, avec un bon professeur particulier et un suivi régulier, des progrès rapides sont tout à fait possibles. EduKaraib met en relation les familles martiniquaises avec des professeurs de maths diplômés, disponibles en visioconférence directement depuis votre domicile, à Fort-de-France, Le Lamentin, Le Robert, Sainte-Marie ou n'importe quelle commune de l'île."
      faq={[
        {
          q: 'Combien coûte un cours de maths particulier en Martinique ?',
          a: "Le tarif varie selon le niveau et le professeur, généralement entre 20€ et 40€ de l'heure + 10€ de frais de plateforme. Les packs 5h et 10h permettent d'économiser jusqu'à 10% sur le tarif horaire. De plus, 50% des frais sont déductibles des impôts pour les familles françaises.",
        },
        {
          q: 'Les cours de maths sont-ils adaptés au programme de Martinique ?',
          a: "Oui. Nos professeurs de maths connaissent le programme de l'Académie de Martinique, de la 6ème jusqu'au Baccalauréat. Ils maîtrisent les spécificités du Bac général, technologique et professionnel des lycées martiniquais.",
        },
        {
          q: 'Mon enfant peut-il avoir des cours de maths en visio en Martinique ?',
          a: "Absolument. EduKaraib intègre une salle de visioconférence directement dans la plateforme. Il suffit d'un ordinateur ou d'une tablette avec internet. Pas besoin de se déplacer, les cours se font depuis chez vous.",
        },
        {
          q: 'Comment trouver un bon prof de maths certifié en Martinique ?',
          a: "Sur EduKaraib, vous pouvez consulter le profil complet de chaque professeur : diplômes, matières enseignées, avis vérifiés des familles, et tarifs. Vous pouvez réserver directement en ligne en quelques clics.",
        },
      ]}
    />
  );
}
