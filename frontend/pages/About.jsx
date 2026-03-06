import React from 'react';
import { useSEO } from '../hooks/useSEO';

export default function About() {
  useSEO({
    title: 'À propos de EduKaraib',
    description: 'Découvrez la mission, l\'équipe et la vision derrière EduKaraib, la plateforme de cours particuliers en Guyane.',
    url: '/about',
  });
  return (
    <div>
      <h2>À propos de EduKaraib</h2>
      <p>Notre mission, notre équipe, notre vision.</p>
    </div>
  );
}
