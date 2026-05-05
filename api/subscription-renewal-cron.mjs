import { adminDb } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  const key = req.query.key || req.headers['x-cron-secret'];
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const now = new Date();
  const periodKey = now.toISOString().slice(0, 7); // YYYY-MM

  const snap = await adminDb.collection('subscriptions')
    .where('status', 'in', ['active', 'cancelling'])
    .get();

  let booked = 0;
  let skipped = 0;
  const errors = [];

  for (const doc of snap.docs) {
    const sub = doc.data();
    if (sub.last_booked_period === periodKey) {
      skipped++;
      continue;
    }
    try {
      await bookSubscriptionLessons(doc.id, sub);
      booked++;
    } catch (e) {
      errors.push({ id: doc.id, error: e.message });
    }
  }

  console.log(`[subscription-renewal-cron] period=${periodKey} booked=${booked} skipped=${skipped} errors=${errors.length}`);
  res.json({ ok: true, period: periodKey, booked, skipped, errors });
}

async function bookSubscriptionLessons(stripeSubId, sub) {
  const { teacher_id, student_id, slot_day, slot_hour, mode, subscription_rate, payer_uid } = sub;
  if (!teacher_id || !student_id || !slot_day || slot_hour == null) return;

  const DAY_MAP = { Lun: 1, Mar: 2, Mer: 3, Jeu: 4, Ven: 5, Sam: 6, Dim: 0 };
  const targetDayNum = DAY_MAP[slot_day];
  if (targetDayNum === undefined) return;

  const now = new Date();
  const periodKey = now.toISOString().slice(0, 7);

  // Double-check guard in case of concurrent runs
  const subRef = adminDb.collection('subscriptions').doc(stripeSubId);
  const fresh = await subRef.get();
  if (fresh.exists && fresh.data().last_booked_period === periodKey) return;

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getDay() !== targetDayNum) {
    cursor.setDate(cursor.getDate() + 1);
  }

  const dates = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(cursor);
    d.setHours(Number(slot_hour), 0, 0, 0);
    dates.push(d);
    cursor.setDate(cursor.getDate() + 7);
  }

  const batch = adminDb.batch();
  for (const d of dates) {
    const dateStr = d.toISOString().slice(0, 10);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const weekStr = monday.toISOString().slice(0, 10);

    const lessonRef = adminDb.collection('lessons').doc();
    batch.set(lessonRef, {
      teacher_id: String(teacher_id),
      student_id: null,
      participant_ids: [String(student_id)],
      participantsMap: {
        [String(student_id)]: {
          status: 'confirmed',
          is_paid: true,
          paid_at: new Date(),
          booked_by: String(payer_uid || student_id),
          parent_id: payer_uid && payer_uid !== student_id ? String(payer_uid) : null,
        },
      },
      slot_day: String(slot_day),
      slot_hour: Number(slot_hour),
      date: dateStr,
      week: weekStr,
      startAt: d,
      mode: mode || 'presentiel',
      is_group: false,
      capacity: 1,
      is_subscription: true,
      subscription_id: String(stripeSubId),
      price_per_hour: Number(subscription_rate || 0),
      status: 'confirmed',
      is_paid: true,
      created_at: new Date(),
    });
  }
  await batch.commit();

  await subRef.set({ last_booked_period: periodKey }, { merge: true });
}
