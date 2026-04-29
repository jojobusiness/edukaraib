import SEOLocalPage from '../SEOLocalPage';

export default function CoursParticuliersGuyane() {
  return (
    <SEOLocalPage
      title="Cours particuliers en Guyane — Soutien scolaire en ligne"
      description="Trouvez un professeur particulier en Guyane francaise. Toutes matieres, tous niveaux. Cours en visio, paiement securise. EduKaraib — la plateforme des Outre-Mer."
      urlPath="/cours-particuliers-guyane"
      heading="Cours particuliers en Guyane"
      subheading="Des professeurs disponibles pour vos enfants en Guyane francaise. Cours a domicile ou en visio."
      island="Guyane"
      subject="toutes matieres"
      islandDescription="La Guyane francaise est un territoire unique avec des besoins specifiques en matiere d'education. EduKaraib met en relation les familles de Cayenne, Kourou, Matoury, Remire-Montjoly et Saint-Laurent-du-Maroni avec des professeurs qualifies pour du soutien scolaire en Maths, Francais, Anglais, SVT, Histoire-Geo et plus encore. Les cours sont proposes a domicile ou en visioconference selon la disponibilite des profs."
      faq={[
        {
          q: 'Combien coute un cours particulier en Guyane ?',
          a: "Le tarif varie selon la matiere et le niveau, generalement entre 20 EUR et 50 EUR de l'heure + 10 EUR de frais de plateforme EduKaraib. Les packs 5h et 10h offrent une remise de 10%. En tant que resident francais, 50% des frais de soutien scolaire sont deductibles de vos impots.",
        },
        {
          q: 'Est-ce que EduKaraib couvre toute la Guyane ?',
          a: "Oui. Nos professeurs interviennent a Cayenne, Kourou, Matoury, Remire-Montjoly, Saint-Laurent-du-Maroni et d'autres communes. Les cours en visio sont disponibles partout en Guyane sans contrainte geographique.",
        },
        {
          q: 'Quelles matieres sont disponibles en Guyane ?',
          a: "Toutes les matieres du programme national : Mathematiques, Francais, Anglais, Espagnol, SVT, Physique-Chimie, Histoire-Geographie, Philosophie, et plus encore. Utilisez le filtre de recherche pour trouver la matiere dont votre enfant a besoin.",
        },
        {
          q: 'Comment fonctionne le paiement en Guyane ?',
          a: "Le paiement est securise via Stripe (carte bancaire, Apple Pay, Google Pay). Vous pouvez payer en 3 fois sans frais. Le professeur recoit son paiement directement sur son compte bancaire apres chaque lecon validee.",
        },
      ]}
    />
  );
}
