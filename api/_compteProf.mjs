// Le compte Stripe d'un prof peut-il recevoir un virement ? (02/11/2026)
//
// On demande à STRIPE, à chaque fois. `users.stripeChargesEnabled` n'était écrit
// par AUCUN code : il valait false pour les 17 profs alors que Stripe en
// déclarait 13 prêts. Conséquence : trigger-payout et admin-verser-prof auraient
// refusé de payer le prof au premier vrai paiement. Un champ recopié finit
// toujours par mentir ; la source de vérité, c'est Stripe.

/**
 * @param {{ accounts: { retrieve: Function } }} stripe
 * @param {string|null|undefined} accountId
 * @returns {Promise<boolean>} false si pas de compte, compte incomplet ou Stripe injoignable
 */
export async function compteProfPret(stripe, accountId) {
  if (!accountId) return false;
  try {
    const compte = await stripe.accounts.retrieve(accountId);
    return !!compte.payouts_enabled && compte.capabilities?.transfers === 'active';
  } catch (e) {
    console.error('[compteProfPret]', accountId, e?.message || e);
    return false;
  }
}
