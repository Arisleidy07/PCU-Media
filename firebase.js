// firebase.js
// Inicializa Firebase para PCU Media
// Configurado para Storage, Analytics y otros servicios

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-analytics.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
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

export const firebaseApp = initializeApp(firebaseConfig);
export const analytics = getAnalytics(firebaseApp);
export const storage = getStorage(firebaseApp);
export const db = getFirestore(firebaseApp);

// Funciones helper para Firebase Storage
export const uploadFileToFirebase = async (file, folderPath = "") => {
  const storageRef = ref(storage, `${folderPath}/${file.name}`);
  const snapshot = await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(snapshot);
  return {
    name: file.name,
    path: `${folderPath}/${file.name}`,
    url: downloadURL,
    size: file.size,
    type: file.type,
  };
};

export const deleteFileFromFirebase = async (filePath) => {
  const storageRef = ref(storage, filePath);
  await deleteObject(storageRef);
};

export const listFilesInFolder = async (folderPath = "") => {
  const storageRef = ref(storage, folderPath);
  const listResult = await listAll(storageRef);

  const files = [];
  for (const itemRef of listResult.items) {
    const downloadURL = await getDownloadURL(itemRef);
    const metadata = await getMetadata(itemRef);
    files.push({
      name: itemRef.name,
      path: itemRef.fullPath,
      url: downloadURL,
      size: metadata.size,
      type: metadata.contentType,
      modified: metadata.updated,
    });
  }

  return files;
};

// Importar funciones necesarias
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
