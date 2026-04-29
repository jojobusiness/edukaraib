import SEOLocalPage from '../SEOLocalPage';

export default function CoursFrancais() {
  return (
    <SEOLocalPage
      title="Cours de Français particuliers aux Caraïbes et DOM-TOM"
      description="Trouvez un professeur de francais en Martinique, Guadeloupe, Guyane et DOM-TOM. Cours en visio ou a domicile, paiement securise. Preparation BAC francais, brevet."
      urlPath="/cours-francais"
      heading="Cours de Français particuliers"
      subheading="Des professeurs de francais certifies dans toute la Caraibe et les DOM-TOM."
      island="Caraibe"
      subject="Francais"
      islandDescription="Le francais est la matiere premiere au brevet (coefficient 3) et au BAC (epreuve anticipee en Premiere). Un bon accompagnement en lecture, grammaire, expression ecrite et analyse litteraire peut faire gagner plusieurs points decisifs. EduKaraib met en relation les familles caribeeennes avec des professeurs de francais diplomes, disponibles en visio ou a domicile."
      faq={[
        {
          q: 'Comment preparer le BAC de francais avec un prof particulier ?',
          a: "Un professeur particulier travaille avec votre enfant sur les textes du programme, les methodes de commentaire, dissertation et oral de francais. Reservez des seances regulieres des la Premiere pour progresser sur la duree.",
        },
        {
          q: 'Les cours de francais sont-ils adaptes au programme local ?',
          a: "Oui. Nos professeurs connaissent les programmes des Academies de Martinique, Guadeloupe et Guyane, avec les oeuvres au programme et les exigences locales du BAC.",
        },
        {
          q: 'Peut-on avoir des cours de francais pour adultes ?',
          a: "Oui. EduKaraib propose des cours de francais pour adultes : remise a niveau, preparation a des concours, perfectionnement en redaction professionnelle.",
        },
        {
          q: 'Quel est le tarif d\'un cours de francais particulier ?',
          a: "Entre 20 EUR et 45 EUR de l'heure + 10 EUR de frais de plateforme. Les packs 5h et 10h offrent une remise de 10%. 50% deductibles des impots en France.",
        },
      ]}
    />
  );
}
