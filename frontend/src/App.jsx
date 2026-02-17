import React, { useState, useEffect } from "react";
import { auth, db, storage } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  getMetadata,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js";

import "./styles.css";

function App() {
  const [user, setUser] = useState(null);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [homeCollapsed, setHomeCollapsed] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        loadFolders();
        if (!currentPath) {
          loadHomeFiles();
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Load folders from Firestore
  const loadFolders = async () => {
    try {
      const q = query(
        collection(db, "folders"),
        where("owner", "==", user.uid),
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFolders(list);
    } catch (e) {
      showToast({ title: "Error", message: e.message, variant: "error" });
    }
  };

  // Load files for a folder
  const loadFiles = async (path = "") => {
    try {
      const folderRef = ref(storage, path);
      const res = await listAll(folderRef);
      const items = await Promise.all(
        res.items.map(async (itemRef) => {
          const url = await getDownloadURL(itemRef);
          const meta = await getMetadata(itemRef);
          return {
            name: itemRef.name,
            fullPath: itemRef.fullPath,
            url,
            size: meta.size,
            type: meta.contentType,
            updated: meta.updated,
          };
        }),
      );
      setFiles(items);
    } catch (e) {
      showToast({ title: "Error", message: e.message, variant: "error" });
    }
  };

  // Load all files for home view
  const loadHomeFiles = async () => {
    try {
      const all = [];
      for (const folder of folders) {
        const folderRef = ref(storage, folder.path);
        const res = await listAll(folderRef);
        const items = await Promise.all(
          res.items.map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            const meta = await getMetadata(itemRef);
            return {
              name: itemRef.name,
              fullPath: itemRef.fullPath,
              url,
              size: meta.size,
              type: meta.contentType,
              updated: meta.updated,
              folder,
            };
          }),
        );
        all.push(...items);
      }
      setFiles(all);
    } catch (e) {
      showToast({ title: "Error", message: e.message, variant: "error" });
    }
  };

  // Toast helper
  const showToast = (toast) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  // Create folder
  const createFolder = async () => {
    if (!newFolderName.trim()) {
      showToast({
        title: "Falta el nombre",
        message: "Escribe el nombre de la carpeta.",
        variant: "error",
      });
      return;
    }
    try {
      await addDoc(collection(db, "folders"), {
        name: newFolderName.trim(),
        parent: newFolderParent || null,
        path: newFolderParent
          ? `${newFolderParent}/${newFolderName.trim()}`
          : newFolderName.trim(),
        owner: user.uid,
        createdAt: serverTimestamp(),
      });
      showToast({
        title: "Carpeta creada",
        message: `Se creó: ${newFolderName}`,
        variant: "success",
      });
      setNewFolderName("");
      setNewFolderParent("");
      setShowFolderModal(false);
      loadFolders();
    } catch (e) {
      showToast({
        title: "No se pudo crear",
        message: e.message,
        variant: "error",
      });
    }
  };

  // Upload files
  const uploadFiles = async () => {
    if (!pendingUploadFiles.length) return;
    try {
      for (const file of pendingUploadFiles) {
        const filePath = currentPath
          ? `${currentPath}/${file.name}`
          : file.name;
        const fileRef = ref(storage, filePath);
        await uploadBytes(fileRef, file);
      }
      showToast({
        title: "Subida completada",
        message: `${pendingUploadFiles.length} archivo(s) subido(s).`,
        variant: "success",
      });
      setPendingUploadFiles([]);
      setShowUploadModal(false);
      loadFiles(currentPath);
    } catch (e) {
      showToast({
        title: "No se pudo subir",
        message: e.message,
        variant: "error",
      });
    }
  };

  // UI helpers
  const openPreview = (file) => {
    setPreviewFile(file);
    setShowPreviewModal(true);
  };
  const closePreview = () => setShowPreviewModal(false);
  const toggleSidebar = (open) => setSidebarOpen(open);

  // Build folder tree for sidebar
  const buildFolderTree = (parentId = null) => {
    return folders
      .filter((f) => f.parent === parentId)
      .map((f) => ({
        ...f,
        children: buildFolderTree(f.id),
      }));
  };
  const folderTree = buildFolderTree();

  // Flatten for selects
  const flattenFolders = (node, prefix = "") => {
    const out = [
      { ...node, path: prefix ? `${prefix}/${node.name}` : node.name },
    ];
    if (node.children) {
      for (const child of node.children) {
        out.push(...flattenFolders(child, out[0].path));
      }
    }
    return out;
  };
  const flatFolders = folderTree.flatMap((n) => flattenFolders(n));

  if (loading) {
    return (
      <div className="loading-screen">
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h2>PCU Media</h2>
          <input type="email" placeholder="Correo" id="email" />
          <input type="password" placeholder="Contraseña" id="password" />
          <button
            onClick={async () => {
              const email = document.getElementById("email").value;
              const password = document.getElementById("password").value;
              try {
                await signInWithEmailAndPassword(auth, email, password);
              } catch (e) {
                showToast({
                  title: "Error",
                  message: e.message,
                  variant: "error",
                });
              }
            }}
          >
            Iniciar sesión
          </button>
          <button
            onClick={async () => {
              const email = document.getElementById("email").value;
              const password = document.getElementById("password").value;
              try {
                await createUserWithEmailAndPassword(auth, email, password);
              } catch (e) {
                showToast({
                  title: "Error",
                  message: e.message,
                  variant: "error",
                });
              }
            }}
          >
            Crear cuenta
          </button>
        </div>
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.variant}`}>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="app" id="root">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="logo">
            <img
              className="brand-logo"
              src="/Playlogo.png"
              alt="PlayCenter Universal"
            />
            <h1>PCU Media</h1>
            <p>PlayCenter Universal</p>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="upload-section">
            <button
              className="upload-btn"
              onClick={() => setShowUploadModal(true)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Subir Archivos
            </button>

            <button
              className="new-folder-btn"
              onClick={() => setShowFolderModal(true)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
              </svg>
              Nueva carpeta
            </button>
          </div>

          <div className="folder-tree">
            <h3>Carpetas</h3>
            <div className="tree-content">
              {folderTree.map((folder) => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  level={0}
                  onSelect={setCurrentPath}
                  currentPath={currentPath}
                />
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div
        className="sidebar-overlay"
        style={{ display: sidebarOpen ? "block" : "none" }}
        onClick={() => toggleSidebar(false)}
      ></div>

      <div className="toast-host">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.variant}`}>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => toggleSidebar(true)}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            <div className="breadcrumbs">
              <span>{currentPath || "Inicio"}</span>
            </div>
          </div>

          <div className="header-actions">
            <select className="sort-select">
              <option value="name">Ordenar por nombre</option>
              <option value="date">Ordenar por fecha</option>
            </select>
          </div>
        </header>

        <div className="gallery-container">
          {currentPath === "" ? (
            <div className="home-accordion">
              {folderTree.map((folder) => (
                <HomeFolderItem
                  key={folder.id}
                  folder={folder}
                  level={0}
                  homeCollapsed={homeCollapsed}
                  setHomeCollapsed={setHomeCollapsed}
                  openPreview={openPreview}
                  files={files}
                />
              ))}
            </div>
          ) : (
            <div className="gallery-grid">
              {files.map((file) => (
                <div
                  key={file.fullPath}
                  className="gallery-item"
                  onClick={() => openPreview(file)}
                >
                  {file.type?.startsWith("image/") ? (
                    <img src={file.url} alt={file.name} />
                  ) : (
                    <video src={file.url} />
                  )}
                  {file.type?.startsWith("video/") && (
                    <span className="video-indicator">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      Video
                    </span>
                  )}
                  <span className="file-name">{file.name}</span>
                </div>
              ))}
            </div>
          )}

          {files.length === 0 && (
            <div className="empty-state">
              <svg
                width="80"
                height="80"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <h3>No hay archivos en esta carpeta</h3>
              <p>
                Arrastra archivos o usa el botón de subir para agregar contenido
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="upload-modal active">
          <div
            className="upload-overlay"
            onClick={() => setShowUploadModal(false)}
          ></div>
          <div className="upload-dialog">
            <h3>Subir Archivos</h3>
            <p>Selecciona la carpeta destino:</p>
            <select
              className="upload-folder-select"
              value={currentPath}
              onChange={(e) => setCurrentPath(e.target.value)}
            >
              <option value="">Inicio</option>
              {flatFolders.map((folder) => (
                <option key={folder.id} value={folder.path}>
                  /{folder.path}
                </option>
              ))}
            </select>
            <div
              className="upload-preview-area"
              onClick={() => document.getElementById("uploadFileInput").click()}
            >
              {pendingUploadFiles.length === 0 ? (
                <p>Arrastra archivos aquí o haz clic para seleccionar</p>
              ) : (
                <div className="selected-files-list">
                  {pendingUploadFiles.map((f) => (
                    <div key={f.name} className="selected-file-item">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                      <span>{f.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input
              type="file"
              id="uploadFileInput"
              multiple
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) =>
                setPendingUploadFiles(Array.from(e.target.files))
              }
            />
            <div className="upload-actions">
              <button
                className="upload-cancel-btn"
                onClick={() => setShowUploadModal(false)}
              >
                Cancelar
              </button>
              <button className="upload-confirm-btn" onClick={uploadFiles}>
                Subir Archivos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="folder-modal active">
          <div
            className="folder-overlay"
            onClick={() => setShowFolderModal(false)}
          ></div>
          <div className="folder-dialog">
            <h3>Nueva carpeta</h3>
            <p>¿Dónde quieres crearla?</p>
            <select
              className="folder-parent-select"
              value={newFolderParent}
              onChange={(e) => setNewFolderParent(e.target.value)}
            >
              <option value="">Inicio</option>
              {flatFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  /{folder.path}
                </option>
              ))}
            </select>
            <p>Nombre de la carpeta:</p>
            <input
              className="folder-name-input"
              type="text"
              placeholder="Ej: Pagos días 30"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <div className="folder-actions">
              <button
                className="folder-cancel-btn"
                onClick={() => setShowFolderModal(false)}
              >
                Cancelar
              </button>
              <button className="folder-create-btn" onClick={createFolder}>
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewFile && (
        <div className="preview-modal active">
          <div className="preview-overlay" onClick={closePreview}></div>
          <div className="preview-content">
            <button className="preview-close" onClick={closePreview}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <div className="preview-media">
              <div className="preview-container">
                {previewFile.type?.startsWith("image/") ? (
                  <img src={previewFile.url} alt={previewFile.name} />
                ) : (
                  <video src={previewFile.url} controls />
                )}
              </div>
            </div>

            <div className="preview-info">
              <h3>{previewFile.name}</h3>
              <div className="file-details">
                <p>
                  <strong>Ruta:</strong> {previewFile.fullPath}
                </p>
                <p>
                  <strong>Fecha:</strong>{" "}
                  {new Date(previewFile.updated).toLocaleString()}
                </p>
                <p>
                  <strong>Tamaño:</strong>{" "}
                  {(previewFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>

              <div className="preview-actions">
                <button className="share-btn">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                  Compartir
                </button>

                <button
                  className="download-btn"
                  onClick={() => window.open(previewFile.url, "_blank")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Descargar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente para árbol de carpetas en sidebar
function FolderTreeItem({ folder, level, onSelect, currentPath }) {
  const indent = { paddingLeft: `${12 + level * 18}px` };
  const isActive = currentPath === folder.path;
  return (
    <div>
      <div
        className={`tree-item ${isActive ? "active" : ""}`}
        style={indent}
        onClick={() => onSelect(folder.path)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        {folder.name}
      </div>
      {folder.children &&
        folder.children.map((child) => (
          <FolderTreeItem
            key={child.id}
            folder={child}
            level={level + 1}
            onSelect={onSelect}
            currentPath={currentPath}
          />
        ))}
    </div>
  );
}

// Componente para vista Inicio (home) carpetas
function HomeFolderItem({
  folder,
  level,
  homeCollapsed,
  setHomeCollapsed,
  openPreview,
  files,
}) {
  const isCollapsed = homeCollapsed.has(folder.id);
  const toggle = () => {
    const next = new Set(homeCollapsed);
    if (isCollapsed) next.delete(folder.id);
    else next.add(folder.id);
    setHomeCollapsed(next);
  };
  const folderFiles = files.filter(
    (f) => f.folder && f.folder.id === folder.id,
  );
  return (
    <div className="home-folder">
      <button
        className="home-folder__row"
        onClick={toggle}
        style={{ paddingLeft: `${12 + level * 18}px` }}
      >
        <span className="home-folder__icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <span className="home-folder__name">{folder.name}</span>
        <span className="home-folder__meta">
          {folderFiles.length} archivo(s)
        </span>
        <span className="home-folder__chev">{isCollapsed ? "▸" : "▾"}</span>
      </button>
      <div
        className="home-folder__body"
        style={{ display: isCollapsed ? "none" : "block" }}
      >
        <div className="home-folder__children">
          {folder.children &&
            folder.children.map((child) => (
              <HomeFolderItem
                key={child.id}
                folder={child}
                level={level + 1}
                homeCollapsed={homeCollapsed}
                setHomeCollapsed={setHomeCollapsed}
                openPreview={openPreview}
                files={files}
              />
            ))}
        </div>
        <div className="home-folder__files">
          {folderFiles.length === 0 ? (
            <div className="home-empty">Sin archivos</div>
          ) : (
            <div className="home-files-grid">
              {folderFiles.map((file) => (
                <div
                  key={file.fullPath}
                  className={`gallery-item home-item`}
                  onClick={() => openPreview(file)}
                >
                  {file.type?.startsWith("image/") ? (
                    <img src={file.url} alt={file.name} />
                  ) : (
                    <video src={file.url} />
                  )}
                  {file.type?.startsWith("video/") && (
                    <span className="video-indicator">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      Video
                    </span>
                  )}
                  <span className="file-name">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
