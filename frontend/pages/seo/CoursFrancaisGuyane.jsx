import React from 'react';
import SEOLocalPage from '../SEOLocalPage';

export default function CoursFrancaisGuyane() {
  return (
    <SEOLocalPage
      title="Cours de Français en Guyane en ligne"
      description="Trouvez un professeur de français en Guyane. Cours particuliers en visio, paiement sécurisé, profs certifiés. Adaptés au programme de l'Académie de Guyane."
      urlPath="/cours-francais-guyane"
      heading="Cours de Français en Guyane"
      subheading="Professeurs de français certifiés disponibles en visio depuis Cayenne, Saint-Laurent ou Kourou."
      island="Guyane"
      subject="Français"
      islandDescription="Le français est la matière fondamentale qui conditionne la réussite dans toutes les autres disciplines. En Guyane, où la diversité linguistique est grande, maîtriser le français écrit et oral est un enjeu crucial pour les élèves. EduKaraib permet aux familles de Cayenne, Saint-Laurent-du-Maroni, Kourou ou Saint-Georges de trouver des professeurs de français compétents, disponibles en visioconférence, spécialement formés pour accompagner les élèves du primaire jusqu'au Baccalauréat selon le programme de l'Académie de Guyane."
      faq={[
        {
          q: 'Combien coûte un cours de français particulier en Guyane ?',
          a: "Les tarifs varient selon le niveau et le professeur, généralement entre 20€ et 40€/h + 10€ de frais de plateforme. 50% des dépenses sont déductibles des impôts pour les résidents français. Les packs 5h et 10h réduisent le coût total.",
        },
        {
          q: 'Les cours sont-ils adaptés au programme de l\'Académie de Guyane ?',
          a: "Oui. Nos professeurs de français connaissent les programmes officiels de l'Académie de Guyane, de la maternelle au Lycée. Ils préparent aux épreuves du DNB et du Bac.",
        },
        {
          q: 'Un enfant non-francophone peut-il bénéficier de ces cours ?',
          a: "Absolument. Nos professeurs sont formés pour accompagner des élèves aux profils variés, y compris ceux dont le français n'est pas la langue maternelle, ce qui est fréquent en Guyane. L'approche est bienveillante et adaptée au rythme de chaque élève.",
        },
        {
          q: 'Comment se déroule un cours de français en visio depuis la Guyane ?',
          a: "Le professeur et l'élève se retrouvent à l'heure convenue dans la salle de visio EduKaraib, directement dans le navigateur. Tableau blanc partagé, documents en ligne : tout est prévu pour un cours aussi efficace qu'en présentiel.",
        },
      ]}
    />
  );
}
