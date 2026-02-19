// firebase.js
// Inicializa Firebase para PCU Media
// Configurado para Storage, Analytics y otros servicios

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-analytics.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD3P5dfS_CRv9YpSqm33Sq5VF9-_GTdv6Q",
  authDomain: "pcu-media.firebaseapp.com",
  projectId: "pcu-media",
  storageBucket: "pcu-media.firebasestorage.app",
  messagingSenderId: "915463451942",
  appId: "1:915463451942:web:408223b651acd0738f3de7",
  measurementId: "G-V9DVBNCJPL",
};

const firebaseApp = initializeApp(firebaseConfig);
const analytics = getAnalytics(firebaseApp);
const storage = getStorage(firebaseApp);
const db = getFirestore(firebaseApp);

// Exponer funciones de upload en window para que app.js pueda usarlas
window.fbStorage = storage;
window.fbRef = ref;
window.fbUploadBytes = uploadBytes;
window.fbGetDownloadURL = getDownloadURL;
