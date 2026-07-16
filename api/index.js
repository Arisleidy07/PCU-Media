// PCU Media Backend Server - Firebase Storage Version
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Helper: genera URL de descarga permanente de Firebase Storage
function firebaseUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

// Helper: obtiene la URL de descarga de un archivo existente en Storage
async function getDownloadUrl(fileRef) {
  const [metadata] = await fileRef.getMetadata();
  const token =
    metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
  if (token) {
    return firebaseUrl(fileRef.bucket.name, fileRef.name, token);
  }
  // Si no tiene token, asignar uno nuevo
  const newToken = crypto.randomUUID();
  await fileRef.setMetadata({
    metadata: { firebaseStorageDownloadTokens: newToken },
  });
  return firebaseUrl(fileRef.bucket.name, fileRef.name, newToken);
}

const app = express();

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

// Middleware para quitar prefijo /api cuando llega mediante rewrite en Vercel
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4); // quita '/api'
  } else if (req.url === "/api") {
    req.url = "/";
  }
  next();
});

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

app.get("/health", async (req, res) => {
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
app.post(
  "/upload",
  (req, res, next) => {
    upload.array("files")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res
          .status(400)
          .json({ error: "Error procesando archivos: " + err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const folderPath = req.query.dest || req.body.dest || "";
      const uploadedFiles = [];

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No se recibieron archivos" });
      }

      console.log("Upload request:", {
        folderPath,
        fileCount: req.files.length,
        files: req.files.map((f) => f.originalname),
      });

      for (const file of req.files) {
        const fileName = `${Date.now()}_${file.originalname}`;
        const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

        const token = crypto.randomUUID();
        const blob = bucket.file(filePath);
        const blobStream = blob.createWriteStream({
          metadata: {
            contentType: file.mimetype,
            metadata: {
              firebaseStorageDownloadTokens: token,
            },
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
  },
);

// Registrar metadata de archivo subido desde el cliente
app.post("/register-file", async (req, res) => {
  try {
    const { name, path, url, size, mimetype, folder } = req.body;
    if (!name || !path || !url) {
      return res
        .status(400)
        .json({ error: "Faltan campos requeridos (name, path, url)" });
    }
    const mt = mimetype || "";
    const type = mt.startsWith("video/")
      ? "video"
      : mt.startsWith("image/")
        ? "image"
        : "document";
    const fileDoc = {
      name,
      fileName: path.split("/").pop(),
      path,
      url,
      size: size || 0,
      mimetype: mimetype || "application/octet-stream",
      folder: folder || "",
      uploadDate: admin.firestore.FieldValue.serverTimestamp(),
      type,
    };
    await db.collection("files").add(fileDoc);
    res.json({ success: true });
  } catch (error) {
    console.error("Error registering file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener archivos de una carpeta desde Firestore
app.get("/files", async (req, res) => {
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
      // Convertir Firestore Timestamp a ISO string
      let modified = null;
      if (data.uploadDate && data.uploadDate.toDate) {
        modified = data.uploadDate.toDate().toISOString();
      } else if (data.uploadDate) {
        modified = data.uploadDate;
      }
      files.push({
        id: doc.id,
        name: data.name,
        path: data.path,
        url: data.url,
        size: data.size,
        mimetype: data.mimetype || "application/octet-stream",
        modified: modified,
        type: data.type,
      });
    });

    // Ordenar por fecha descendente en memoria (evita necesitar composite index)
    files.sort((a, b) => {
      if (!a.modified) return 1;
      if (!b.modified) return -1;
      return new Date(b.modified) - new Date(a.modified);
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
app.delete("/file", async (req, res) => {
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

// Renombrar archivo (acepta path o fileId)
app.post("/file/rename", async (req, res) => {
  try {
    const { fileId, path, newName } = req.body;

    if ((!fileId && !path) || !newName) {
      return res
        .status(400)
        .json({ error: "Faltan parámetros (path o fileId, y newName)" });
    }

    let docRef, doc;
    if (fileId) {
      docRef = db.collection("files").doc(fileId);
      doc = await docRef.get();
    } else {
      const snapshot = await db
        .collection("files")
        .where("path", "==", path)
        .get();
      if (snapshot.empty) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }
      doc = snapshot.docs[0];
      docRef = doc.ref;
    }

    if (!doc.exists && !doc.data) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const data = doc.data();
    const oldPath = data.path;
    const folder = data.folder;
    const newPath = folder ? `${folder}/${newName}` : newName;

    // Renombrar en Firebase Storage
    await bucket.file(oldPath).move(bucket.file(newPath));

    // Obtener URL de descarga del nuevo archivo
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

// Mover archivo a otra carpeta
app.post("/file/move", async (req, res) => {
  try {
    const { path: filePath, dest, overwrite } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "Se requiere path del archivo" });
    }

    // Buscar archivo en Firestore
    const snapshot = await db
      .collection("files")
      .where("path", "==", filePath)
      .get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    const doc = snapshot.docs[0];
    const data = doc.data();
    const fileName = data.name || filePath.split("/").pop();
    const newPath = dest ? `${dest}/${fileName}` : fileName;

    // Mover en Firebase Storage
    await bucket.file(filePath).move(bucket.file(newPath));

    // Obtener URL de descarga del nuevo archivo
    const newUrl = await getDownloadUrl(bucket.file(newPath));
    await doc.ref.update({
      path: newPath,
      folder: dest || "",
      url: newUrl,
    });

    res.json({ success: true, path: newPath, url: newUrl });
  } catch (error) {
    console.error("Error moving file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Renombrar carpeta
app.post("/folder/rename", async (req, res) => {
  try {
    const { path: folderPath, newName } = req.body;

    if (!folderPath || !newName) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const parts = folderPath.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");

    // Mover todos los archivos en Storage que estén bajo esta carpeta
    const [storageFiles] = await bucket.getFiles({ prefix: folderPath + "/" });
    const movedFiles = [];
    for (const file of storageFiles) {
      const newFilePath = file.name.replace(folderPath, newPath);
      await file.move(bucket.file(newFilePath));
      const url = await getDownloadUrl(bucket.file(newFilePath));
      movedFiles.push({ oldPath: file.name, newPath: newFilePath, url });
    }

    // Actualizar documentos de archivos en Firestore
    const filesSnapshot = await db
      .collection("files")
      .where("folder", "==", folderPath)
      .get();
    const batch1 = db.batch();
    filesSnapshot.forEach((doc) => {
      const data = doc.data();
      const newFilePath = data.path.replace(folderPath, newPath);
      const moved = movedFiles.find((m) => m.newPath === newFilePath);
      const newUrl = moved ? moved.url : data.url;
      batch1.update(doc.ref, {
        path: newFilePath,
        folder: newPath,
        url: newUrl,
      });
    });
    await batch1.commit();

    // Actualizar subcarpetas en Firestore
    const allFolders = await db.collection("folders").get();
    const batch2 = db.batch();
    allFolders.forEach((doc) => {
      const data = doc.data();
      if (data.path === folderPath) {
        batch2.update(doc.ref, { name: newName, path: newPath });
      } else if (data.path.startsWith(folderPath + "/")) {
        const updatedPath = data.path.replace(folderPath, newPath);
        const updatedParent = data.parent
          ? data.parent.replace(folderPath, newPath)
          : data.parent;
        batch2.update(doc.ref, { path: updatedPath, parent: updatedParent });
      }
    });
    await batch2.commit();

    res.json({ success: true, name: newName, path: newPath });
  } catch (error) {
    console.error("Error renaming folder:", error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar carpeta y su contenido
app.delete("/folder", async (req, res) => {
  try {
    const folderPath = req.query.path;

    if (!folderPath) {
      return res.status(400).json({ error: "Se requiere path de la carpeta" });
    }

    // Eliminar todos los archivos en Storage bajo esta carpeta
    const [storageFiles] = await bucket.getFiles({ prefix: folderPath + "/" });
    for (const file of storageFiles) {
      await file.delete().catch(() => {});
    }

    // Eliminar documentos de archivos en Firestore
    const filesSnapshot = await db
      .collection("files")
      .where("folder", "==", folderPath)
      .get();
    const batch1 = db.batch();
    filesSnapshot.forEach((doc) => batch1.delete(doc.ref));
    await batch1.commit();

    // Eliminar la carpeta y subcarpetas en Firestore
    const allFolders = await db.collection("folders").get();
    const batch2 = db.batch();
    allFolders.forEach((doc) => {
      const data = doc.data();
      if (data.path === folderPath || data.path.startsWith(folderPath + "/")) {
        batch2.delete(doc.ref);
      }
    });
    await batch2.commit();

    // También eliminar archivos de subcarpetas en Firestore
    const subFiles = await db.collection("files").get();
    const batch3 = db.batch();
    subFiles.forEach((doc) => {
      const data = doc.data();
      if (data.folder && data.folder.startsWith(folderPath + "/")) {
        batch3.delete(doc.ref);
      }
    });
    await batch3.commit();

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    res.status(500).json({ error: error.message });
  }
});

// Guardar orden personalizado de archivos
app.post("/order", async (req, res) => {
  try {
    const { folder, order } = req.body;
    const key = folder || "__root__";
    await db
      .collection("order")
      .doc(key)
      .set({ order: order || [] });
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving order:", error);
    res.status(500).json({ error: error.message });
  }
});

// Crear carpeta
app.post("/folders", async (req, res) => {
  try {
    const { parent, name } = req.body;
    const folderPath = parent ? `${parent}/${name}` : name;

    // Verificar que no exista ya
    const existing = await db
      .collection("folders")
      .where("path", "==", folderPath)
      .get();
    if (!existing.empty) {
      return res.status(409).json({ error: "La carpeta ya existe" });
    }

    // Crear un archivo .folder para simular la carpeta en Storage
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

// Obtener estructura de carpetas (árbol jerárquico)
app.get("/folders", async (req, res) => {
  try {
    const snapshot = await db.collection("folders").get();
    const flat = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      flat.push({
        name: data.name,
        path: data.path,
        parent: data.parent || "",
        children: [],
      });
    });

    // Ordenar por profundidad para construir el árbol correctamente
    flat.sort((a, b) => {
      const da = a.path.split("/").length;
      const db2 = b.path.split("/").length;
      return da - db2;
    });

    // Construir árbol
    const map = {};
    const roots = [];
    for (const folder of flat) {
      map[folder.path] = folder;
    }
    for (const folder of flat) {
      if (folder.parent && map[folder.parent]) {
        map[folder.parent].children.push(folder);
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

// Proxy para forzar descarga directa de archivos de Firebase Storage.
// NOTA: Vercel serverless limita el tamaño de respuesta (~4.5 MB en Hobby),
// por lo que el frontend ya evita este proxy para archivos grandes.
app.get("/download-proxy", async (req, res) => {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL requerida" });
    }

    // Fetch del archivo desde Firebase Storage
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Error descargando archivo: ${response.status}`);
    }

    // Obtener el tipo de contenido
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    // Sanitizar nombre de archivo para evitar caracteres problemáticos
    const safeName = filename
      ? String(filename).replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, "_")
      : "download";

    // Configurar headers para forzar descarga
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Cache-Control", "no-cache");

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error("Error en download-proxy:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: error.message || "Error descargando archivo" });
    }
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message || String(err) });
});

// Export para Vercel serverless
module.exports = app;
