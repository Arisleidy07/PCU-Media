// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD3P5dfS_CRv9YpSqm33Sq5VF9-_GTdv6Q",
  authDomain: "pcu-media.firebaseapp.com",
  projectId: "pcu-media",
  storageBucket: "pcu-media.firebasestorage.app",
  messagingSenderId: "915463451942",
  appId: "1:915463451942:web:408223b651acd0738f3de7",
  measurementId: "G-V9DVBNCJPL",
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-analytics.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

export default app;
