import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBwKTh_KzE5z8bPkR5eGDE7R1GGAQfxHZY",
  authDomain: "study-planner-b31ca.firebaseapp.com",
  projectId: "study-planner-b31ca",
  storageBucket: "study-planner-b31ca.firebasestorage.app",
  messagingSenderId: "896313634480",
  appId: "1:896313634480:web:a65a35bbba9155d2269575",
  measurementId: "G-E1N85PXRM4",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const authReady = setPersistence(auth, browserLocalPersistence).catch(() => undefined);
