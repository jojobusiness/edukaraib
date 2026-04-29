import React from 'react';
import SEOLocalPage from '../SEOLocalPage';

export default function CoursParticuliersGuadeloupe() {
  return (
    <SEOLocalPage
      title="Cours particuliers en Guadeloupe — Soutien scolaire en ligne"
      description="Cours particuliers en Guadeloupe : professeurs certifiés pour toutes les matières. Visio, paiement en 3x, packs 5h et 10h. EduKaraib, la référence du soutien scolaire aux Antilles."
      urlPath="/cours-particuliers-guadeloupe"
      heading="Cours particuliers en Guadeloupe"
      subheading="Trouvez le professeur idéal pour votre enfant en Guadeloupe — toutes matières, tous niveaux, en visio."
      island="Guadeloupe"
      subject={null}
      islandDescription="La Guadeloupe et ses îles — Grande-Terre, Basse-Terre, Marie-Galante, La Désirade — méritent une solution de soutien scolaire adaptée à leur réalité géographique. EduKaraib est né pour ça : une plateforme 100% en ligne, pensée pour les familles guadeloupéennes qui veulent donner à leurs enfants accès aux meilleurs professeurs, où qu'ils habitent. De Pointe-à-Pitre à Capesterre-Belle-Eau, de Sainte-Anne à Saint-François, nos professeurs particuliers en Guadeloupe dispensent des cours en visio pour toutes les matières, du CE2 au Baccalauréat."
      faq={[
        {
          q: 'Combien coûtent les cours particuliers en Guadeloupe ?',
          a: "Les tarifs varient selon la matière et le niveau, généralement entre 20€ et 50€/h + 10€ de frais de plateforme. Le crédit d'impôt de 50% permet aux foyers fiscaux français de récupérer la moitié de la dépense. Les packs 5h et 10h offrent une réduction supplémentaire.",
        },
        {
          q: 'Comment trouver un professeur particulier à Marie-Galante ou en Basse-Terre ?',
          a: "Sur EduKaraib, tous les cours se font en visio. Peu importe où vous habitez en Guadeloupe, vous avez accès au même catalogue de professeurs. Il vous suffit d'une connexion internet et d'un appareil (ordinateur, tablette ou smartphone).",
        },
        {
          q: 'Quelles matières propose EduKaraib en Guadeloupe ?',
          a: "Toutes les matières du programme académique : Mathématiques, Français, Anglais, Espagnol, Histoire-Géographie, Physique-Chimie, SVT, Philosophie, Informatique et plus encore. Nouveaux professeurs ajoutés régulièrement.",
        },
        {
          q: 'EduKaraib est-il différent de SuperProf pour la Guadeloupe ?',
          a: "Oui. Contrairement à SuperProf qui est généraliste, EduKaraib est spécialement conçu pour les Antilles. Les professeurs sont sélectionnés pour leur connaissance des programmes académiques locaux, et le paiement est 100% sécurisé en ligne — contrairement à beaucoup de profs particuliers locaux qui fonctionnent encore en cash.",
        },
        {
          q: 'Mon enfant peut-il avoir un essai avant de s\'engager sur un pack ?',
          a: "Oui. Vous pouvez réserver un cours unitaire avant d'acheter un pack. Cela permet à votre enfant de tester la relation avec le professeur avant de s'engager sur 5h ou 10h.",
        },
      ]}
    />
  );
}
