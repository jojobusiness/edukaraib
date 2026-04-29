import SEOLocalPage from '../SEOLocalPage';

export default function CoursAnglais() {
  return (
    <SEOLocalPage
      title="Cours d'Anglais particuliers aux Caraïbes et DOM-TOM"
      description="Trouvez un professeur d'anglais en Martinique, Guadeloupe, Guyane et DOM-TOM. Cours en visio ou a domicile, paiement securise. Preparation BAC, TOEFL, IELTS."
      urlPath="/cours-anglais"
      heading="Cours d'Anglais particuliers"
      subheading="Des professeurs d'anglais certifies dans toute la Caraibe et les DOM-TOM."
      island="Caraibe"
      subject="Anglais"
      islandDescription="L'anglais est une matiere strategique pour les etudes et la carriere. Aux Caraïbes, la maitrise de l'anglais ouvre des portes vers les universites americaines, canadiennes et britanniques. EduKaraib vous connecte avec des professeurs d'anglais diplomes, dont certains natifs ou bilingues, disponibles en visio depuis n'importe quelle ile de la Caraibe."
      faq={[
        {
          q: 'Comment trouver un prof d\'anglais en ligne aux Caraïbes ?',
          a: "Recherchez 'Anglais' sur EduKaraib et filtrez par votre ile ou selectionnez 'En ligne' pour acceder aux profs disponibles partout. Consultez les profils et reservez directement.",
        },
        {
          q: 'Puis-je me preparer au TOEFL ou IELTS avec EduKaraib ?',
          a: "Oui. Mentionnez votre objectif lors de la reservation. Certains professeurs sont specialises en preparation aux certifications anglophones (TOEFL, IELTS, Cambridge).",
        },
        {
          q: 'Y a-t-il des professeurs d\'anglais natifs sur EduKaraib ?',
          a: "Certains de nos professeurs sont anglophones natifs ou ont etudie dans des pays anglophones. Consultez les profils pour voir leurs diplomes et experiences.",
        },
        {
          q: 'A partir de quel age peut-on prendre des cours d\'anglais ?',
          a: "Des le CP. EduKaraib propose des cours d'anglais pour tous les niveaux : primaire, college, lycee, superieur et adultes souhaitant progresser.",
        },
      ]}
    />
  );
}
