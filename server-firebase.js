// PCU Media Backend Server - Firebase Storage Version
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

// Lazy initialization para Firebase Admin (compatible con Vercel serverless)
let bucket, db;

function initFirebase() {
  if (admin.apps.length) {
    bucket = admin.storage().bucket();
    db = admin.firestore();
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKeyRaw || !storageBucket) {
    throw new Error(
      "Faltan variables de entorno de Firebase Admin. Requiere FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY y FIREBASE_STORAGE_BUCKET.",
    );
  }

  // Vercel guarda saltos de linea como \n, hay que convertirlos a saltos reales
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    storageBucket,
  });

  bucket = admin.storage().bucket();
  db = admin.firestore();
}

// Middleware para inicializar Firebase en la primera request
app.use((req, res, next) => {
  if (!bucket || !db) {
    try {
      initFirebase();
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Firebase initialization failed: " + error.message });
    }
  }
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Configuración de multer para subida de archivos (memoria temporal)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de imagen y video"));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB límite
  },
});

// Rutas de la API

app.get("/api/health", async (req, res) => {
  try {
    res.json({
      ok: true,
      message: "PCU Media API con Firebase Storage funcionando",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Subir archivos a Firebase Storage
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const folderPath = req.body.dest || "";
    const uploadedFiles = [];

    for (const file of req.files) {
      const fileName = `${Date.now()}_${file.originalname}`;
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

      const blob = bucket.file(filePath);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", reject);
        blobStream.on("finish", resolve);
        blobStream.end(file.buffer);
      });

      // Hacer el archivo público
      await blob.makePublic();

      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

      // Guardar metadata en Firestore
      const fileDoc = {
        name: file.originalname,
        fileName: fileName,
        path: filePath,
        url: publicUrl,
        size: file.size,
        mimetype: file.mimetype,
        folder: folderPath,
        uploadDate: admin.firestore.FieldValue.serverTimestamp(),
        type: file.mimetype.startsWith("image/") ? "image" : "video",
      };

      await db.collection("files").add(fileDoc);

      uploadedFiles.push({
        name: file.originalname,
        path: filePath,
        url: publicUrl,
        size: file.size,
        mimetype: file.mimetype,
        type: fileDoc.type,
      });
    }

    res.json({
      success: true,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener archivos de una carpeta desde Firestore
app.get("/api/files", async (req, res) => {
  try {
    const folderPath = req.query.path || "";

    let query = db.collection("files");
    if (folderPath) {
      query = query.where("folder", "==", folderPath);
    } else {
      query = query.where("folder", "==", "");
    }

    const snapshot = await query.orderBy("uploadDate", "desc").get();
    const files = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      files.push({
        id: doc.id,
        name: data.name,
        path: data.path,
        url: data.url,
        size: data.size,
        modified: data.uploadDate,
        type: data.type,
      });
    });

    res.json({
      path: folderPath,
      files,
      orderApplied: false,
    });
  } catch (error) {
    console.error("Error getting files:", error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar archivo de Firebase Storage y Firestore
app.delete("/api/file", async (req, res) => {
  try {
    const fileId = req.query.id;
    const filePath = req.query.path;

    if (!fileId && !filePath) {
      return res
        .status(400)
        .json({ error: "Se requiere id o path del archivo" });
    }

    let fileDoc;
    if (fileId) {
      const doc = await db.collection("files").doc(fileId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }
      fileDoc = { id: doc.id, ...doc.data() };
    } else {
      // Buscar por path
      const snapshot = await db
        .collection("files")
        .where("path", "==", filePath)
        .get();
      if (snapshot.empty) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }
      const doc = snapshot.docs[0];
      fileDoc = { id: doc.id, ...doc.data() };
    }

    // Eliminar de Firebase Storage
    await bucket.file(fileDoc.path).delete();

    // Eliminar de Firestore
    await db.collection("files").doc(fileDoc.id).delete();

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Renombrar archivo (actualizar metadata en Firestore)
app.post("/api/file/rename", async (req, res) => {
  try {
    const { fileId, newName } = req.body;

    if (!fileId || !newName) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const docRef = db.collection("files").doc(fileId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const data = doc.data();
    const oldPath = data.path;
    const folder = data.folder;
    const newPath = folder ? `${folder}/${newName}` : newName;

    // Renombrar en Firebase Storage
    await bucket.file(oldPath).move(bucket.file(newPath));

    // Actualizar metadata en Firestore
    const newUrl = `https://storage.googleapis.com/${bucket.name}/${newPath}`;
    await docRef.update({
      name: newName,
      path: newPath,
      url: newUrl,
    });

    res.json({
      success: true,
      name: newName,
      path: newPath,
      url: newUrl,
    });
  } catch (error) {
    console.error("Error renaming file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Crear carpeta (solo en Firestore, Firebase Storage no tiene carpetas reales)
app.post("/api/folders", async (req, res) => {
  try {
    const { parent, name } = req.body;
    const folderPath = parent ? `${parent}/${name}` : name;

    // Crear un archivo .folder para simular la carpeta
    const folderMarkerPath = `${folderPath}/.folder`;
    const blob = bucket.file(folderMarkerPath);

    await blob.save("folder", {
      metadata: {
        contentType: "text/plain",
      },
    });

    // Guardar metadata de la carpeta en Firestore
    await db.collection("folders").add({
      name,
      path: folderPath,
      parent: parent || "",
      createdDate: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      name,
      path: folderPath,
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener estructura de carpetas
app.get("/api/folders", async (req, res) => {
  try {
    const snapshot = await db.collection("folders").get();
    const folders = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      folders.push({
        name: data.name,
        path: data.path,
        children: [],
      });
    });

    res.json({
      root: "",
      name: "PCU Media",
      children: folders,
    });
  } catch (error) {
    console.error("Error getting folders:", error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy para descargar archivos (evita problemas de CORS)
app.get("/api/download-proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "URL requerida" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "attachment");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error in download proxy:", error);
    res.status(500).json({ error: error.message });
  }
});

// Servir archivos estáticos
app.use(express.static("."));

// Manejo de errores
app.use((err, req, res, next) => {
  if (!err) return next();
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message || String(err) });
});

// Iniciar servidor
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(
      `PCU Media Server con Firebase Storage corriendo en puerto ${PORT}`,
    );
    console.log(
      "Archivos guardados en Firebase Storage (bucket): " +
        (bucket?.name ?? "pendiente de inicialización"),
    );
  });
}

module.exports = app;
