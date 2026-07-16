// PCU Media Backend Server - Firebase Storage Version
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

function firebaseUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function getDownloadUrl(fileRef) {
  const [metadata] = await fileRef.getMetadata();
  const token =
    metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
  if (token) return firebaseUrl(fileRef.bucket.name, fileRef.name, token);
  const newToken = crypto.randomUUID();
  await fileRef.setMetadata({
    metadata: { firebaseStorageDownloadTokens: newToken },
  });
  return firebaseUrl(fileRef.bucket.name, fileRef.name, newToken);
}

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
    const folderPath = req.query.dest || req.body.dest || "";
    const uploadedFiles = [];

    for (const file of req.files) {
      const fileName = `${Date.now()}_${file.originalname}`;
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

      const token = crypto.randomUUID();
      const blob = bucket.file(filePath);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", reject);
        blobStream.on("finish", resolve);
        blobStream.end(file.buffer);
      });

      const publicUrl = firebaseUrl(bucket.name, filePath, token);

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
        type: file.mimetype.startsWith("image/")
          ? "image"
          : file.mimetype.startsWith("video/")
            ? "video"
            : "document",
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

app.post("/api/register-file", async (req, res) => {
  try {
    const { name, path, url, size, mimetype, folder } = req.body;
    if (!name || !path || !url) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }
    const type = String(mimetype || "").startsWith("video/")
      ? "video"
      : String(mimetype || "").startsWith("image/")
        ? "image"
        : "document";
    await db.collection("files").add({
      name,
      fileName: path.split("/").pop(),
      path,
      url,
      size: Number(size) || 0,
      mimetype: mimetype || "application/octet-stream",
      folder: folder || "",
      uploadDate: admin.firestore.FieldValue.serverTimestamp(),
      type,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error registering file:", error);
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

    const snapshot = await query.get();
    const files = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      files.push({
        id: doc.id,
        name: data.name,
        path: data.path,
        url: data.url,
        size: data.size,
        mimetype: data.mimetype || "application/octet-stream",
        modified: data.uploadDate,
        type: data.type,
      });
    });

    files.sort((a, b) => {
      const aDate =
        a.modified && a.modified.toDate ? a.modified.toDate() : a.modified;
      const bDate =
        b.modified && b.modified.toDate ? b.modified.toDate() : b.modified;
      return new Date(bDate || 0) - new Date(aDate || 0);
    });
    res.json({
      path: folderPath,
      files: files.map((file) => ({
        ...file,
        modified:
          file.modified && file.modified.toDate
            ? file.modified.toDate().toISOString()
            : file.modified || null,
      })),
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
    const { fileId, path, newName } = req.body;

    if ((!fileId && !path) || !newName) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    let docRef;
    let doc;
    if (fileId) {
      docRef = db.collection("files").doc(fileId);
      doc = await docRef.get();
    } else {
      const snapshot = await db
        .collection("files")
        .where("path", "==", path)
        .get();
      doc = snapshot.docs[0];
      docRef = doc && doc.ref;
    }

    if (!doc || !doc.exists) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const data = doc.data();
    const oldPath = data.path;
    const folder = data.folder;
    const newPath = folder ? `${folder}/${newName}` : newName;

    // Renombrar en Firebase Storage
    await bucket.file(oldPath).move(bucket.file(newPath));

    const newUrl = await getDownloadUrl(bucket.file(newPath));
    await docRef.update({
      name: newName,
      fileName: newName,
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

app.post("/api/file/move", async (req, res) => {
  try {
    const { path, dest } = req.body;
    if (!path)
      return res.status(400).json({ error: "Se requiere path del archivo" });
    const snapshot = await db
      .collection("files")
      .where("path", "==", path)
      .get();
    const doc = snapshot.docs[0];
    if (!doc) return res.status(404).json({ error: "Archivo no encontrado" });
    const data = doc.data();
    const fileName = data.fileName || path.split("/").pop();
    const newPath = dest ? `${dest}/${fileName}` : fileName;
    await bucket.file(path).move(bucket.file(newPath));
    const url = await getDownloadUrl(bucket.file(newPath));
    await doc.ref.update({ path: newPath, folder: dest || "", url });
    res.json({ success: true, path: newPath, url });
  } catch (error) {
    console.error("Error moving file:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/folder/rename", async (req, res) => {
  try {
    const { path, newName } = req.body;
    if (!path || !newName)
      return res.status(400).json({ error: "Faltan parámetros" });
    const parts = path.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");
    const [storageFiles] = await bucket.getFiles({ prefix: `${path}/` });
    const urlsByPath = new Map();
    for (const file of storageFiles) {
      const updatedPath = file.name.replace(`${path}/`, `${newPath}/`);
      await file.move(bucket.file(updatedPath));
      urlsByPath.set(
        updatedPath,
        await getDownloadUrl(bucket.file(updatedPath)),
      );
    }
    const [fileDocs, folderDocs] = await Promise.all([
      db.collection("files").get(),
      db.collection("folders").get(),
    ]);
    const batch = db.batch();
    fileDocs.forEach((doc) => {
      const data = doc.data();
      if (data.path === path || data.path.startsWith(`${path}/`)) {
        const updatedPath = data.path.replace(path, newPath);
        batch.update(doc.ref, {
          path: updatedPath,
          folder: (data.folder || "").replace(path, newPath),
          url: urlsByPath.get(updatedPath) || data.url,
        });
      }
    });
    folderDocs.forEach((doc) => {
      const data = doc.data();
      if (data.path === path || data.path.startsWith(`${path}/`)) {
        batch.update(doc.ref, {
          name: data.path === path ? newName : data.name,
          path: data.path.replace(path, newPath),
          parent: (data.parent || "").replace(path, newPath),
        });
      }
    });
    await batch.commit();
    res.json({ success: true, name: newName, path: newPath });
  } catch (error) {
    console.error("Error renaming folder:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/folder", async (req, res) => {
  try {
    const path = String(req.query.path || "");
    if (!path)
      return res.status(400).json({ error: "Se requiere path de la carpeta" });
    const [storageFiles, fileDocs, folderDocs] = await Promise.all([
      bucket.getFiles({ prefix: `${path}/` }),
      db.collection("files").get(),
      db.collection("folders").get(),
    ]);
    await Promise.all(
      storageFiles[0].map((file) => file.delete().catch(() => {})),
    );
    const batch = db.batch();
    fileDocs.forEach((doc) => {
      const folder = doc.data().folder || "";
      if (folder === path || folder.startsWith(`${path}/`))
        batch.delete(doc.ref);
    });
    folderDocs.forEach((doc) => {
      const folderPath = doc.data().path || "";
      if (folderPath === path || folderPath.startsWith(`${path}/`))
        batch.delete(doc.ref);
    });
    await batch.commit();
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/order", async (req, res) => {
  try {
    const folder = String(req.body.folder || "__root__").replace(/\//g, "__");
    await db
      .collection("order")
      .doc(folder)
      .set({ order: Array.isArray(req.body.order) ? req.body.order : [] });
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving order:", error);
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
        parent: data.parent || "",
        children: [],
      });
    });

    folders.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));
    const roots = [];
    for (const folder of folders) {
      if (folder.parent && byPath.has(folder.parent)) {
        byPath.get(folder.parent).children.push(folder);
      } else {
        roots.push(folder);
      }
    }

    res.json({
      root: "",
      name: "PCU Media",
      children: roots,
    });
  } catch (error) {
    console.error("Error getting folders:", error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy para descargar archivos (evita problemas de CORS)
app.get("/api/download-proxy", async (req, res) => {
  try {
    const { url, filename } = req.query;
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

    const safeName = filename
      ? filename.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, "_")
      : "archivo";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
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
