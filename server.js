// PCU Media Backend Server
const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = 3000;

const ROOT_MEDIA_DIR = path.resolve(
  process.env.PCU_MEDIA_ROOT || path.join(__dirname, "media"),
);

// Asegurar que la carpeta raíz exista siempre
(async () => {
  try {
    await fs.mkdir(ROOT_MEDIA_DIR, { recursive: true });
  } catch (e) {
    void 0;
  }
})();

// Middleware
app.use(cors());
app.use(express.json());
// Registrar rutas estáticas DESPUÉS de las APIs para que no interfieran
// con métodos POST/PUT/etc. a las mismas rutas.

/* Las rutas API están declaradas más abajo. */

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const destRel =
        (req.query && req.query.dest ? String(req.query.dest) : "") ||
        (req.body && req.body.dest ? String(req.body.dest) : "");
      const destAbs = resolveInRoot(destRel);
      const stat = await fs.stat(destAbs);
      if (!stat.isDirectory()) {
        return cb(new Error("La carpeta destino no es válida"));
      }

      cb(null, destAbs);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Mantener el nombre original del archivo
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Solo permitir imágenes y videos
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
    const stat = await fs.stat(ROOT_MEDIA_DIR);
    res.json({
      ok: true,
      root: ROOT_MEDIA_DIR,
      rootExists: stat.isDirectory(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Delete a file
app.delete("/api/file", async (req, res) => {
  try {
    const fileRel = req.query && req.query.path ? String(req.query.path) : "";
    if (!fileRel) return res.status(400).json({ error: "Falta path" });
    const fileAbs = resolveInRoot(fileRel);
    const parentAbs = path.dirname(fileAbs);
    const origName = path.basename(fileAbs);

    // Si no existe, considerar como eliminado para no bloquear la UI
    try {
      const stat = await fs.stat(fileAbs);
      if (!stat.isFile()) {
        return res.status(400).json({ error: "No es un archivo" });
      }
    } catch (e) {
      if (e && e.code === "ENOENT") {
        await updateOrderOnDelete(parentAbs, origName);
        return res.json({ success: true });
      }
      throw e;
    }

    // Intento de eliminación normal
    try {
      await fs.unlink(fileAbs);
      await updateOrderOnDelete(parentAbs, origName);
      return res.json({ success: true });
    } catch (e) {
      // Fallbacks para archivo en uso o permisos
      if (
        e &&
        (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES")
      ) {
        try {
          // Intentar eliminación forzada primero
          await fs.rm(fileAbs, { force: true });
          await updateOrderOnDelete(parentAbs, origName);
          return res.json({ success: true });
        } catch (_) {
          // Renombrar a temporal y programar eliminación en background con reintentos
          const tempName =
            ".pcu_deleted_" +
            Date.now().toString(36) +
            "_" +
            Math.random().toString(36).slice(2) +
            "_" +
            origName;
          const tempAbs = path.join(parentAbs, tempName);
          try {
            await fs.rename(fileAbs, tempAbs);
            await updateOrderOnDelete(parentAbs, origName);
            (function scheduleBackgroundRemoval(abs, attempt = 0) {
              const maxAttempts = 6;
              const delayMs = Math.min(500 * Math.pow(2, attempt), 8000);
              setTimeout(async () => {
                try {
                  await fs.rm(abs, { force: true });
                } catch (err) {
                  if (attempt + 1 < maxAttempts) {
                    scheduleBackgroundRemoval(abs, attempt + 1);
                  }
                }
              }, delayMs);
            })(tempAbs);
            return res.json({ success: true });
          } catch (renameErr) {
            if (renameErr && renameErr.code === "ENOENT") {
              await updateOrderOnDelete(parentAbs, origName);
              return res.json({ success: true });
            }
            throw e;
          }
        }
      }
      throw e;
    }
  } catch (error) {
    res.status(500).json({ error: error.message || "Error al eliminar" });
  }
});

// Rename a file within its folder
app.post("/api/file/rename", async (req, res) => {
  try {
    const fileRel = req.body && req.body.path ? String(req.body.path) : "";
    const newNameRaw =
      req.body && req.body.newName ? String(req.body.newName) : "";
    const newName = newNameRaw.trim();
    const overwrite = !!(req.body && req.body.overwrite);
    if (!fileRel || !newName)
      return res.status(400).json({ error: "Faltan parámetros" });
    if (
      newName.includes("/") ||
      newName.includes("\\") ||
      newName === "." ||
      newName === ".."
    ) {
      return res.status(400).json({ error: "Nombre no válido" });
    }

    const fileAbs = resolveInRoot(fileRel);
    const stat = await fs.stat(fileAbs);
    if (!stat.isFile())
      return res.status(400).json({ error: "No es un archivo" });

    const parentAbs = path.dirname(fileAbs);
    const destAbs = path.join(parentAbs, newName);

    // Si el nombre es exactamente el mismo, no hacer nada y devolver éxito
    if (destAbs === fileAbs) {
      return res.json({
        success: true,
        path: toRelFromRoot(destAbs),
        name: path.basename(destAbs),
        noChange: true,
      });
    }

    const sameIgnoringCase =
      destAbs.toLowerCase() === fileAbs.toLowerCase() && destAbs !== fileAbs;

    // Ensure not existing (or handle overwrite)
    try {
      const existing = await fs.stat(destAbs);
      if (existing) {
        if (!sameIgnoringCase) {
          if (existing.isFile()) {
            if (overwrite) {
              await fs.unlink(destAbs);
            } else {
              return res
                .status(409)
                .json({ error: "Ya existe un elemento con ese nombre" });
            }
          } else if (existing.isDirectory()) {
            return res
              .status(409)
              .json({ error: "Ya existe una carpeta con ese nombre" });
          }
        }
      }
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }

    if (sameIgnoringCase) {
      // Forzar cambio de mayúsculas/minúsculas en FS case-insensitive
      const tmpAbs = path.join(
        parentAbs,
        `.__pcu_tmp__${Date.now()}__${Math.random().toString(36).slice(2)}`,
      );
      await fs.rename(fileAbs, tmpAbs);
      await fs.rename(tmpAbs, destAbs);
    } else {
      await fs.rename(fileAbs, destAbs);
    }
    await updateOrderOnRename(
      parentAbs,
      path.basename(fileAbs),
      path.basename(destAbs),
    );

    res.json({
      success: true,
      path: toRelFromRoot(destAbs),
      name: path.basename(destAbs),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move a file to a different folder
app.post("/api/file/move", async (req, res) => {
  try {
    const fileRel = req.body && req.body.path ? String(req.body.path) : "";
    const destRel = req.body && req.body.dest ? String(req.body.dest) : "";
    const overwrite = !!(req.body && req.body.overwrite);
    if (!fileRel)
      return res.status(400).json({ error: "Falta path del archivo" });
    const fileAbs = resolveInRoot(fileRel);
    const srcStat = await fs.stat(fileAbs);
    if (!srcStat.isFile())
      return res.status(400).json({ error: "No es un archivo" });

    const destAbsFolder = resolveInRoot(destRel);
    const destStat = await fs.stat(destAbsFolder).catch(() => null);
    if (!destStat || !destStat.isDirectory())
      return res.status(400).json({ error: "Carpeta destino no válida" });

    const newAbs = path.join(destAbsFolder, path.basename(fileAbs));
    // Handle existing destination
    try {
      const existing = await fs.stat(newAbs);
      if (existing) {
        if (existing.isFile()) {
          if (overwrite) {
            await fs.unlink(newAbs);
          } else {
            return res.status(409).json({
              error: "Ya existe un archivo con ese nombre en destino",
            });
          }
        } else if (existing.isDirectory()) {
          return res
            .status(409)
            .json({ error: "Ya existe una carpeta con ese nombre en destino" });
        }
      }
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }

    await fs.rename(fileAbs, newAbs);

    // Update orders: remove from source, append to destination
    const srcParent = path.dirname(fileAbs);
    await updateOrderOnDelete(srcParent, path.basename(fileAbs));
    await updateOrderOnMove(destAbsFolder, path.basename(newAbs));

    res.json({ success: true, path: toRelFromRoot(newAbs) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save manual order for a folder
app.post("/api/order", async (req, res) => {
  try {
    const folderRel =
      req.body && req.body.folder ? String(req.body.folder) : "";
    const order =
      req.body && Array.isArray(req.body.order)
        ? req.body.order.map(String)
        : [];
    const folderAbs = resolveInRoot(folderRel);
    const stat = await fs.stat(folderAbs);
    if (!stat.isDirectory())
      return res.status(400).json({ error: "Carpeta no válida" });
    await saveOrder(folderAbs, order);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete folder (optional recursive)
app.delete("/api/folder", async (req, res) => {
  try {
    const folderRel = req.query && req.query.path ? String(req.query.path) : "";
    const recursive =
      String((req.query && req.query.recursive) || "false") === "true";
    if (!folderRel) return res.status(400).json({ error: "Falta path" });
    const folderAbs = resolveInRoot(folderRel);
    // Verificar existencia; si no existe, considerar éxito
    try {
      const stat = await fs.stat(folderAbs);
      if (!stat.isDirectory())
        return res.status(400).json({ error: "No es una carpeta" });
    } catch (e) {
      if (e && e.code === "ENOENT") {
        return res.json({ success: true });
      }
      throw e;
    }

    if (recursive) {
      try {
        await fs.rm(folderAbs, { recursive: true, force: true });
        return res.json({ success: true });
      } catch (e) {
        if (
          e &&
          (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES")
        ) {
          // Renombrar a temporal y programar eliminación en background
          const parentAbs = path.dirname(folderAbs);
          const origName = path.basename(folderAbs);
          const tempName =
            ".pcu_deleted_" +
            Date.now().toString(36) +
            "_" +
            Math.random().toString(36).slice(2) +
            "_" +
            origName;
          const tempAbs = path.join(parentAbs, tempName);
          try {
            await fs.rename(folderAbs, tempAbs);
            (function scheduleBackgroundRemoval(abs, attempt = 0) {
              const maxAttempts = 6;
              const delayMs = Math.min(500 * Math.pow(2, attempt), 8000);
              setTimeout(async () => {
                try {
                  await fs.rm(abs, { recursive: true, force: true });
                } catch (err) {
                  if (attempt + 1 < maxAttempts) {
                    scheduleBackgroundRemoval(abs, attempt + 1);
                  }
                }
              }, delayMs);
            })(tempAbs);
            return res.json({ success: true });
          } catch (renameErr) {
            if (renameErr && renameErr.code === "ENOENT") {
              return res.json({ success: true });
            }
            throw e;
          }
        }
        throw e;
      }
    } else {
      try {
        const items = await fs.readdir(folderAbs);
        if (items.length)
          return res.status(400).json({ error: "La carpeta no está vacía" });
        await fs.rmdir(folderAbs);
        return res.json({ success: true });
      } catch (e) {
        if (
          e &&
          (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES")
        ) {
          const parentAbs = path.dirname(folderAbs);
          const origName = path.basename(folderAbs);
          const tempName =
            ".pcu_deleted_" +
            Date.now().toString(36) +
            "_" +
            Math.random().toString(36).slice(2) +
            "_" +
            origName;
          const tempAbs = path.join(parentAbs, tempName);
          try {
            await fs.rename(folderAbs, tempAbs);
            (function scheduleBackgroundRemoval(abs, attempt = 0) {
              const maxAttempts = 6;
              const delayMs = Math.min(500 * Math.pow(2, attempt), 8000);
              setTimeout(async () => {
                try {
                  await fs.rm(abs, { recursive: true, force: true });
                } catch (err) {
                  if (attempt + 1 < maxAttempts) {
                    scheduleBackgroundRemoval(abs, attempt + 1);
                  }
                }
              }, delayMs);
            })(tempAbs);
            return res.json({ success: true });
          } catch (renameErr) {
            if (renameErr && renameErr.code === "ENOENT") {
              return res.json({ success: true });
            }
            throw e;
          }
        }
        throw e;
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename a folder
app.post("/api/folder/rename", async (req, res) => {
  try {
    const folderRel = req.body && req.body.path ? String(req.body.path) : "";
    const newNameRaw =
      req.body && req.body.newName ? String(req.body.newName) : "";
    const newName = newNameRaw.trim();
    if (!folderRel || !newName)
      return res.status(400).json({ error: "Faltan parámetros" });
    if (
      newName.includes("/") ||
      newName.includes("\\") ||
      newName === "." ||
      newName === ".."
    ) {
      return res.status(400).json({ error: "Nombre no válido" });
    }

    const srcAbs = resolveInRoot(folderRel);
    const stat = await fs.stat(srcAbs);
    if (!stat.isDirectory())
      return res.status(400).json({ error: "No es una carpeta" });
    const parentAbs = path.dirname(srcAbs);
    const destAbs = path.join(parentAbs, newName);

    // Si es el mismo path exacto, devolver éxito sin cambios
    if (destAbs === srcAbs) {
      return res.json({
        success: true,
        path: toRelFromRoot(destAbs),
        name: newName,
        noChange: true,
      });
    }

    const sameIgnoringCase =
      destAbs.toLowerCase() === srcAbs.toLowerCase() && destAbs !== srcAbs;

    try {
      const existing = await fs.stat(destAbs);
      if (existing && existing.isDirectory()) {
        if (!sameIgnoringCase) {
          return res
            .status(409)
            .json({ error: "Ya existe una carpeta con ese nombre" });
        }
      }
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }

    if (sameIgnoringCase) {
      const tmpAbs = path.join(
        parentAbs,
        `.__pcu_tmp__${Date.now()}__${Math.random().toString(36).slice(2)}`,
      );
      await fs.rename(srcAbs, tmpAbs);
      await fs.rename(tmpAbs, destAbs);
    } else {
      await fs.rename(srcAbs, destAbs);
    }
    res.json({ success: true, path: toRelFromRoot(destAbs), name: newName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener estructura de carpetas
app.get("/api/folders", async (req, res) => {
  try {
    const baseRel = req.query && req.query.path ? String(req.query.path) : "";
    const baseAbs = resolveInRoot(baseRel);
    const tree = await getFolderTree(baseAbs);
    res.json({
      root: "",
      name: path.basename(ROOT_MEDIA_DIR) || "media",
      children: tree,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/folders", async (req, res) => {
  void 0;
  try {
    const parentRel =
      req.body && req.body.parent ? String(req.body.parent) : "";
    const nameRaw = req.body && req.body.name ? String(req.body.name) : "";
    const name = nameRaw.trim();

    if (!name) {
      return res.status(400).json({ error: "Nombre de carpeta requerido" });
    }
    if (
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("..") ||
      name === "." ||
      name === ".."
    ) {
      return res.status(400).json({ error: "Nombre de carpeta no válido" });
    }

    const parentAbs = resolveInRoot(parentRel);
    const parentStat = await fs.stat(parentAbs);
    if (!parentStat.isDirectory()) {
      return res.status(400).json({ error: "Carpeta destino no válida" });
    }

    const newAbs = path.join(parentAbs, name);
    const newRel = toRelFromRoot(newAbs);
    resolveInRoot(newRel);

    try {
      const existing = await fs.stat(newAbs);
      if (existing.isDirectory()) {
        return res.status(409).json({ error: "La carpeta ya existe" });
      }
      return res
        .status(409)
        .json({ error: "Ya existe un elemento con ese nombre" });
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }

    await fs.mkdir(newAbs);

    res.json({ success: true, name, path: newRel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener archivos de una carpeta
app.get("/api/files", async (req, res) => {
  try {
    const folderRel = req.query && req.query.path ? String(req.query.path) : "";
    const folderAbs = resolveInRoot(folderRel);
    let files = await getFilesInFolder(folderAbs);

    // Apply manual order if present
    let orderApplied = false;
    try {
      const order = await loadOrder(folderAbs);
      if (Array.isArray(order) && order.length) {
        files = applyOrder(files, order);
        orderApplied = true;
      }
    } catch (e) {
      // ignore order errors
    }

    res.json({
      path: toRelFromRoot(folderAbs),
      files,
      orderApplied,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Subir archivos
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const uploadedFiles = req.files.map((file) => ({
      name: file.originalname,
      path: toRelFromRoot(file.path),
      size: file.size,
      mimetype: file.mimetype,
      uploadDate: new Date(),
    }));

    res.json({
      success: true,
      files: uploadedFiles,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Servir archivo (query param recomendado)
app.get("/api/file", async (req, res) => {
  try {
    const fileRel = req.query && req.query.path ? String(req.query.path) : "";
    const fullPath = resolveInRoot(fileRel);

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    res.sendFile(fullPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Servir archivos estáticos
app.get("/api/file/*", async (req, res) => {
  try {
    const fileRel = String(req.params[0] || "");
    const fullPath = resolveInRoot(fileRel);

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    res.sendFile(fullPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message || String(err) });
});

// Funciones auxiliares

function toRelFromRoot(absPath) {
  const rel = path.relative(ROOT_MEDIA_DIR, absPath);
  if (rel === "") return "";
  return rel.split(path.sep).join("/");
}

function resolveInRoot(relPath) {
  const safeRel = String(relPath || "").replace(/^\/+/, "");
  const abs = path.resolve(ROOT_MEDIA_DIR, safeRel);
  if (abs !== ROOT_MEDIA_DIR && !abs.startsWith(ROOT_MEDIA_DIR + path.sep)) {
    throw new Error("Acceso denegado");
  }
  return abs;
}

async function getFolderTree(baseAbsPath) {
  try {
    const items = await fs.readdir(baseAbsPath, { withFileTypes: true });
    const folders = [];

    for (const item of items) {
      if (!item.isDirectory()) continue;
      const childAbs = path.join(baseAbsPath, item.name);
      const children = await getFolderTree(childAbs);
      folders.push({
        name: item.name,
        path: toRelFromRoot(childAbs),
        children,
      });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    return folders;
  } catch (error) {
    void 0;
    return [];
  }
}

async function getFilesInFolder(folderPath) {
  try {
    const items = await fs.readdir(folderPath, { withFileTypes: true });
    const files = [];

    for (const item of items) {
      if (item.isFile()) {
        const itemPath = path.join(folderPath, item.name);
        const stats = await fs.stat(itemPath);

        // Solo incluir imágenes y videos
        const ext = path.extname(item.name).toLowerCase();
        const imageExtensions = [
          ".jpg",
          ".jpeg",
          ".png",
          ".gif",
          ".bmp",
          ".webp",
        ];
        const videoExtensions = [
          ".mp4",
          ".avi",
          ".mov",
          ".wmv",
          ".flv",
          ".webm",
        ];

        if (imageExtensions.includes(ext) || videoExtensions.includes(ext)) {
          const relPath = toRelFromRoot(itemPath);
          files.push({
            name: item.name,
            path: relPath,
            size: stats.size,
            modified: stats.mtime,
            type: imageExtensions.includes(ext) ? "image" : "video",
            url: `/api/file?path=${encodeURIComponent(relPath)}`,
          });
        }
      }
    }

    return files;
  } catch (error) {
    void 0;
    return [];
  }
}

async function loadOrder(folderAbs) {
  const fp = path.join(folderAbs, ".pcu_order.json");
  try {
    const txt = await fs.readFile(fp, "utf8");
    try {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) return arr.map(String);
      return null;
    } catch (_) {
      // Archivo de orden corrupto o inválido: ignorar y seguir
      return null;
    }
  } catch (e) {
    // Si no existe, simplemente no hay orden guardado
    if (e && e.code === "ENOENT") return null;
    // Cualquier otro error al leer: ignorar para no bloquear operaciones
    return null;
  }
}

async function saveOrder(folderAbs, order) {
  const fp = path.join(folderAbs, ".pcu_order.json");
  await fs.writeFile(fp, JSON.stringify(order || [], null, 2), "utf8");
}

function applyOrder(files, order) {
  const idx = new Map();
  order.forEach((name, i) => idx.set(String(name), i));
  return [...files].sort((a, b) => {
    const ai = idx.has(a.name) ? idx.get(a.name) : Number.POSITIVE_INFINITY;
    const bi = idx.has(b.name) ? idx.get(b.name) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

async function updateOrderOnDelete(folderAbs, removedName) {
  try {
    const current = await loadOrder(folderAbs);
    if (!current) return;
    const next = current.filter((n) => n !== removedName);
    await saveOrder(folderAbs, next);
  } catch (_) {
    // Ignorar errores de orden para no impedir acciones de archivo
  }
}

async function updateOrderOnRename(folderAbs, oldName, newName) {
  try {
    const current = await loadOrder(folderAbs);
    if (!current) return;
    const next = current.map((n) => (n === oldName ? newName : n));
    await saveOrder(folderAbs, next);
  } catch (_) {
    // Ignorar errores de orden para no impedir acciones de archivo
  }
}

async function updateOrderOnMove(folderAbs, name) {
  try {
    const current = (await loadOrder(folderAbs)) || [];
    if (!current.includes(name)) current.push(name);
    await saveOrder(folderAbs, current);
  } catch (_) {
    // Ignorar errores de orden para no impedir acciones de archivo
  }
}

// Servir archivos estáticos (HTML, CSS, JS) **después** de definir rutas API
app.use(express.static("."));

// Iniciar servidor
async function startServer() {
  try {
    const stat = await fs.stat(ROOT_MEDIA_DIR);
    if (!stat.isDirectory()) {
      throw new Error("ROOT_MEDIA_DIR no es un directorio");
    }
  } catch (e) {
    void 0;
    throw e;
  }

  app.listen(PORT, () => {
    void 0;
    void 0;
    void 0;
  });
}

startServer().catch(() => {});
