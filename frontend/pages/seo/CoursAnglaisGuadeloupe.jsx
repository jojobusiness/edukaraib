import React from 'react';
import SEOLocalPage from '../SEOLocalPage';

export default function CoursAnglaisGuadeloupe() {
  return (
    <SEOLocalPage
      title="Cours d'Anglais en Guadeloupe en ligne"
      description="Trouvez un professeur d'anglais en Guadeloupe. Cours particuliers en visio, paiement sécurisé, profs certifiés. Pack 5h et 10h disponibles."
      urlPath="/cours-anglais-guadeloupe"
      heading="Cours d'Anglais en Guadeloupe"
      subheading="Des professeurs d'anglais certifiés, disponibles en visio depuis chez vous en Guadeloupe."
      island="Guadeloupe"
      subject="Anglais"
      islandDescription="L'anglais est une compétence essentielle pour les élèves guadeloupéens, que ce soit pour réussir aux examens ou pour s'ouvrir aux marchés caribéens anglophones voisins. Avec EduKaraib, les familles de Pointe-à-Pitre, Basse-Terre, Baie-Mahault, Sainte-Anne ou du Gosier peuvent trouver un professeur d'anglais qualifié disponible en visioconférence, sans sortir de chez elles. Nos profs d'anglais en Guadeloupe préparent vos enfants au DNB, au Baccalauréat et aux certifications comme le TOEIC ou le Cambridge."
      faq={[
        {
          q: "Combien coûte un cours d'anglais particulier en Guadeloupe ?",
          a: "Les tarifs varient entre 20€ et 40€ de l'heure selon le professeur + 10€ de frais de plateforme. Les packs 5h et 10h offrent une réduction. 50% des frais sont déductibles des impôts pour les résidents français.",
        },
        {
          q: "Les cours d'anglais sont-ils adaptés au programme de Guadeloupe ?",
          a: "Oui. Nos professeurs connaissent le programme de l'Académie de Guadeloupe, de la 6ème au Baccalauréat. Ils préparent aussi aux épreuves orales du Bac et aux certifications linguistiques.",
        },
        {
          q: "Est-ce utile de prendre des cours d'anglais particuliers en Guadeloupe ?",
          a: "Oui, surtout pour les élèves qui veulent s'améliorer à l'oral ou rattraper leur retard. Les classes en Guadeloupe ont souvent des effectifs importants, ce qui laisse peu de temps à chaque élève. Un cours particulier permet un suivi personnalisé.",
        },
        {
          q: 'Comment réserver un cours en ligne depuis la Guadeloupe ?',
          a: "Créez un compte gratuitement sur EduKaraib, cherchez un professeur d'anglais, sélectionnez un créneau et payez en ligne par carte ou en 3 fois sans frais. Le cours se déroule ensuite en visio directement sur la plateforme.",
        },
      ]}
    />
  );
}
