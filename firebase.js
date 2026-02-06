// firebase.js
// Inicializa Firebase para PCU Media
// Carga Analytics por ahora; se pueden añadir Auth, Firestore y Storage cuando se necesiten.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-analytics.js";
// Ejemplo para futuros servicios:
// import { getAuth } from "firebase/auth";
// import { getFirestore } from "firebase/firestore";
// import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD3P5dfS_CRv9YpSqm33Sq5VF9-_GTdv6Q",
  authDomain: "pcu-media.firebaseapp.com",
  projectId: "pcu-media",
  storageBucket: "pcu-media.appspot.com", // corregido dominio
  messagingSenderId: "915463451942",
  appId: "1:915463451942:web:408223b651acd0738f3de7",
  measurementId: "G-V9DVBNCJPL",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const analytics = getAnalytics(firebaseApp);

// Export placeholders for futuros usos
// export const auth = getAuth(firebaseApp);
// export const db = getFirestore(firebaseApp);
// export const storage = getStorage(firebaseApp);
