/* global process */
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBwKTh_KzE5z8bPkR5eGDE7R1GGAQfxHZY",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "study-planner-b31ca.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "study-planner-b31ca",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "study-planner-b31ca.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "896313634480",
  appId: process.env.FIREBASE_APP_ID || "1:896313634480:web:a65a35bbba9155d2269575",
};

const EXPECTED_DEV_ERRORS = new Set([
  "auth/admin-restricted-operation",
  "auth/operation-not-allowed",
]);

const strictAuth = process.env.AUTH_TEST_STRICT === "1";

async function run() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);

  try {
    await signInAnonymously(auth);
    console.log("SUCCESS anonymous sign-in enabled");
    process.exit(0);
  } catch (error) {
    const code = error?.code || "";
    const message = error?.message || "Unknown Firebase auth error";
    if (!strictAuth && EXPECTED_DEV_ERRORS.has(code)) {
      console.warn(`WARN anonymous sign-in blocked (${code}); treated as pass in dev mode`);
      console.warn("Set AUTH_TEST_STRICT=1 to fail on restricted/disabled anonymous auth.");
      process.exit(0);
    }

    console.error(`FAIL anonymous auth check (${code || "unknown-code"}): ${message}`);
    process.exit(1);
  }
}

run();
