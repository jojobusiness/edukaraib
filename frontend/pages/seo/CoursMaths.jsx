import SEOLocalPage from '../SEOLocalPage';

export default function CoursMaths() {
  return (
    <SEOLocalPage
      title="Cours de Maths particuliers aux Caraïbes et DOM-TOM"
      description="Trouvez un professeur de mathematiques en Martinique, Guadeloupe, Guyane et DOM-TOM. Cours en visio ou a domicile, paiement securise, essai gratuit disponible."
      urlPath="/cours-maths"
      heading="Cours de Maths particuliers"
      subheading="Des professeurs de mathematiques certifies dans toute la Caraibe et les DOM-TOM."
      island="Caraibe"
      subject="Mathematiques"
      islandDescription="Les mathematiques sont la matiere decisive au brevet et au baccalaureat. Que vous soyez en Martinique, en Guadeloupe, en Guyane, a la Reunion ou en France metropolitaine, EduKaraib vous met en relation avec un professeur de maths qualifie. Cours en visioconference ou a domicile selon votre localisation. Du CP au BAC, tous niveaux."
      faq={[
        {
          q: 'Comment trouver un prof de maths en ligne aux Caraïbes ?',
          a: "Utilisez le moteur de recherche EduKaraib, filtrez par 'Mathematiques' et selectionnez votre ile ou 'En ligne'. Vous pouvez consulter les profils, les avis et reserver directement.",
        },
        {
          q: 'Quel est le tarif moyen d\'un cours de maths particulier ?',
          a: "Entre 20 EUR et 50 EUR de l'heure selon le niveau et le professeur, plus 10 EUR de frais de plateforme. Les packs 5h et 10h offrent une remise de 10%. 50% deductibles des impots pour les residents francais.",
        },
        {
          q: 'Les cours de maths sont-ils adaptes au programme local ?',
          a: "Oui. Nos professeurs connaissent les programmes des Academies de Martinique, Guadeloupe, Guyane et de la Reunion, ainsi que le programme metropolitain.",
        },
        {
          q: 'Y a-t-il un essai gratuit pour les cours de maths ?',
          a: "Certains professeurs proposent une 1h d'essai gratuite. Consultez les profils : le bouton 'Essai gratuit' apparait sur les profils des profs qui l'activent.",
        },
      ]}
    />
  );
}
