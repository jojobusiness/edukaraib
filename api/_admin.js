import admin from 'firebase-admin';
import Stripe from 'stripe';

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // ex: edukaraib.appspot.com
  });
}

export const db = admin.firestore();
export const authAdmin = admin.auth();
export const bucket = admin.storage().bucket();

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, 
    {
  apiVersion: '2024-06-20',
});