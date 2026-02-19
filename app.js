// PCU Media - PlayCenter Universal
class PCUMedia {
  constructor() {
    this.currentPath = "";
    this.files = [];
    this.sortBy = "custom";
    this.folderTree = { name: "Inicio", path: "", children: [] };
    this.flatFolders = [{ name: "Inicio", path: "" }];
    this.currentPreviewFile = null;
    this.pendingUploadFiles = [];
    this.pendingUploadNames = [];
    this.pendingUploadObjectUrls = [];
    this.pendingUploadDescs = [];
    this.activeTab = "home";
    this.homeCollapsed = new Set();
    this.treeCollapsed = new Set();
    this.homeFolderFiles = new Map();
    this.folderSectionsCollapsed = new Set();
    this.activeActionMenu = null;
    this.draggingEl = null;
    this.fileToMove = null;
    this.fileToRename = null;
    this.fileToDelete = null;
    this.folderToRename = null;
    this.folderToDelete = null;
    this.customFolderOrder = this.loadFolderOrder();
    this.audioCtx = null;
    this.fileMeta = this.loadFileMeta();
    this.init();
  }

  // ===== File Meta (descripciones locales) =====
  loadFileMeta() {
    try {
      const raw = window.localStorage.getItem("pcu_file_meta");
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  saveFileMeta() {
    try {
      window.localStorage.setItem(
        "pcu_file_meta",
        JSON.stringify(this.fileMeta || {}),
      );
    } catch (_) {}
  }

  getFileMeta(path) {
    const key = String(path || "");
    return (this.fileMeta && this.fileMeta[key]) || {};
  }

  setFileMeta(path, data) {
    const key = String(path || "");
    if (!this.fileMeta) this.fileMeta = {};
    const prev = this.fileMeta[key] || {};
    this.fileMeta[key] = { ...prev, ...data };
    this.saveFileMeta();
  }

  moveFileMeta(oldPath, newPath) {
    const o = String(oldPath || "");
    const n = String(newPath || "");
    if (!o || !n || o === n) return;
    if (this.fileMeta && this.fileMeta[o]) {
      this.fileMeta[n] = this.fileMeta[o];
      delete this.fileMeta[o];
      this.saveFileMeta();
    }
  }

  deleteFileMeta(path) {
    const key = String(path || "");
    if (this.fileMeta && this.fileMeta[key]) {
      delete this.fileMeta[key];
      this.saveFileMeta();
    }
  }

  async savePreviewEdits() {
    const file = this.currentPreviewFile;
    if (!file) return;
    const nameInput = document.getElementById("previewNameInput");
    const nameExt = document.getElementById("previewNameExt");
    const descInput = document.getElementById("previewDescInput");
    const base = (nameInput && String(nameInput.value || "").trim()) || "";
    const ext = (nameExt && String(nameExt.textContent || "")) || "";
    const newName = base + ext;
    const newDesc = descInput ? String(descInput.value || "").trim() : "";
    const oldPath = file.path || "";
    const folder = oldPath.split("/").slice(0, -1).join("/");

    try {
      // Rename if needed
      if (newName && newName !== file.name) {
        const res = await fetch("/api/file/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.path, newName }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error((data && data.error) || "No se pudo renombrar");
        const newPath = folder ? folder + "/" + newName : newName;
        this.moveFileMeta(oldPath, newPath);
        file.name = newName;
        file.path = newPath;
      }

      // Save description to local meta
      if (file.path) this.setFileMeta(file.path, { description: newDesc });

      // Refresh UI lists to reflect rename
      await this.loadFiles();
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderFolderTree();

      // Update preview title/path
      const fileName = document.getElementById("previewFileName");
      const filePath = document.getElementById("previewFilePath");
      if (fileName) fileName.textContent = file.name;
      if (filePath)
        filePath.textContent = this.currentPath
          ? `${this.currentPath}/${file.name}`
          : file.name;

      const descBlock = document.getElementById("previewDescBlock");
      const descText = document.getElementById("previewDescText");
      if (descText) descText.textContent = newDesc;
      if (descBlock) {
        const hasText = !!(newDesc && newDesc.trim());
        descBlock.style.display = hasText ? "block" : "none";
      }

      this.showToast({
        title: "Guardado",
        message: "Nombre y descripción actualizados",
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo guardar",
        variant: "error",
      });
    }
  }

  setPreviewEditMode(on) {
    const info = document.getElementById("previewInfo");
    if (!info) return;
    const enable = !!on;
    info.classList.toggle("is-editing", enable);
    const btn = document.getElementById("previewEditBtn");
    if (btn) {
      const label = btn.querySelector("span");
      if (label) label.textContent = enable ? "Cerrar edición" : "Editar";
    }
    const descBlock = document.getElementById("previewDescBlock");
    const descText = document.getElementById("previewDescText");
    if (descBlock) {
      if (enable) {
        descBlock.style.display = "none";
      } else {
        const hasText = !!(
          descText && String(descText.textContent || "").trim()
        );
        descBlock.style.display = hasText ? "block" : "none";
      }
    }
    if (enable) {
      const input = document.getElementById("previewNameInput");
      if (input && input.focus) setTimeout(() => input.focus(), 30);
    }
  }

  setActiveTab(tab) {
    const newTab = tab === "folders" ? "folders" : "home";
    this.activeTab = newTab;
    // Toggle nav button state
    const tabHome = document.getElementById("tabHome");
    const tabFolders = document.getElementById("tabFolders");
    if (tabHome) tabHome.classList.toggle("is-active", newTab === "home");
    if (tabFolders)
      tabFolders.classList.toggle("is-active", newTab === "folders");

    // Mostrar/Ocultar botonera flotante solo en "Carpetas"
    const fabDock = document.getElementById("fabDock");
    if (fabDock) fabDock.style.display = newTab === "folders" ? "flex" : "none";

    // Actualizar barra de carpeta
    this.updateFolderToolbar();

    // In Inicio, navegar a raíz para ver lista de carpetas
    if (newTab === "home") {
      if (this.currentPath) {
        this.navigateToFolder("");
      } else {
        this.renderGallery();
      }
    } else {
      // En Carpetas, mantener la ruta actual; si está vacía, mostrar la misma lista con acciones.
      this.renderGallery();
    }
  }

  isHomeView() {
    // Ahora solo existe la vista Inicio; cuando entras a una carpeta (currentPath != "") ya no es Home
    return !this.currentPath;
  }

  updateFolderToolbar() {
    const toolbar = document.getElementById("folderToolbar");
    const nameEl = document.getElementById("currentFolderName");
    const backBtn = document.getElementById("backToHomeBtn");
    if (!toolbar || !nameEl || !backBtn) return;
    const inFolder = !!(this.currentPath && this.currentPath.length);
    toolbar.style.display = inFolder ? "flex" : "none";
    if (inFolder) {
      const parts = this.currentPath.split("/").filter(Boolean);
      nameEl.textContent = parts[parts.length - 1] || this.currentPath;
    } else {
      nameEl.textContent = "";
    }
  }

  openRenameFileModal(file) {
    const modal = document.getElementById("renameFileModal");
    if (!modal) return;
    this.fileToRename = file;
    const input = document.getElementById("renameFileInput");
    const extEl = document.getElementById("renameFileExt");
    const parts = this.splitFileName(file.name);
    if (input) {
      input.value = parts.base || "";
      window.setTimeout(() => input.focus(), 30);
    }
    if (extEl) extEl.textContent = parts.ext || "";
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeRenameFileModal() {
    const modal = document.getElementById("renameFileModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.fileToRename = null;
  }

  async confirmRenameFile() {
    const file = this.fileToRename;
    if (!file) return;
    const input = document.getElementById("renameFileInput");
    const extEl = document.getElementById("renameFileExt");
    const typed = input ? String(input.value || "").trim() : "";
    const ext = extEl ? String(extEl.textContent || "") : "";
    if (!typed) {
      if (input) input.focus();
      return;
    }
    if (
      typed.includes("/") ||
      typed.includes("\\") ||
      typed === "." ||
      typed === ".."
    ) {
      this.showToast({
        title: "Nombre no válido",
        message: "El nombre no puede contener /, \\ ni ser . o ..",
        variant: "error",
      });
      if (input) input.focus();
      return;
    }
    const newName = typed.includes(".") ? typed : typed + ext;
    const overwriteEl = document.getElementById("renameOverwrite");
    const overwrite = !!(overwriteEl && overwriteEl.checked);
    try {
      const prevFiles = this.files.slice();
      this.closeRenameFileModal();
      const folder = (file.path || "").split("/").slice(0, -1).join("/");
      const updated = this.files.map((f) => {
        if ((f.path || "") === (file.path || "")) {
          return { ...f, name: newName };
        }
        return f;
      });
      this.files = updated;
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderGallery();

      const res = await fetch("/api/file/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, newName, overwrite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data && data.error) || "No se pudo renombrar");
      const newPath = folder ? folder + "/" + newName : newName;
      this.moveFileMeta(file.path, newPath);
      await this.loadFiles();
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderFolderTree();
      this.showToast({
        title: "Renombrado",
        message: newName,
        variant: "success",
      });
    } catch (e) {
      try {
        if (Array.isArray(prevFiles)) {
          this.files = prevFiles;
          this.renderGallery();
        }
      } catch {}
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo renombrar",
        variant: "error",
      });
    }
  }

  openDeleteFileModal(file) {
    const modal = document.getElementById("deleteFileModal");
    if (!modal) return;
    this.fileToDelete = file;
    const nameEl = document.getElementById("deleteFileName");
    if (nameEl) nameEl.textContent = file.name;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeDeleteFileModal() {
    const modal = document.getElementById("deleteFileModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.fileToDelete = null;
  }

  async confirmDeleteFileModal() {
    const file = this.fileToDelete;
    if (!file) return;
    try {
      const prevFiles = this.files.slice();
      this.closeDeleteFileModal();
      this.files = this.files.filter(
        (f) => (f.path || "") !== (file.path || ""),
      );
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderGallery();

      const qp = new URLSearchParams();
      qp.set("path", file.path);
      const res = await fetch(`/api/file?${qp.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data && data.error) || "No se pudo eliminar");
      this.deleteFileMeta(file.path);
      await this.loadFiles();
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderFolderTree();
      this.showToast({
        title: "Eliminado",
        message: file.name,
        variant: "success",
      });
    } catch (e) {
      try {
        // Revertir UI optimista si falló
        const key = this.currentPath || "";
        const arr = await this.loadFolderFiles(key).catch(() => []);
        if (Array.isArray(arr)) {
          this.files = arr;
          this.renderGallery();
        }
      } catch {}
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo eliminar",
        variant: "error",
      });
    }
  }

  openRenameFolderModal(node) {
    const modal = document.getElementById("renameFolderModal");
    if (!modal) return;
    this.folderToRename = node;
    const input = document.getElementById("renameFolderInput");
    if (input) {
      input.value = node.name || "";
      window.setTimeout(() => input.focus(), 30);
    }
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeRenameFolderModal() {
    const modal = document.getElementById("renameFolderModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.folderToRename = null;
  }

  async confirmRenameFolderModal() {
    const node = this.folderToRename;
    if (!node) return;
    const input = document.getElementById("renameFolderInput");
    const newName = input ? String(input.value || "").trim() : "";
    if (!newName) {
      if (input) input.focus();
      return;
    }
    try {
      this.closeRenameFolderModal();
      // UI optimista: actualizar nombre en el árbol
      this.updateFolderNameInTree(node.path || "", newName);
      const res = await fetch("/api/folder/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.path || "", newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data && data.error) || "No se pudo renombrar la carpeta",
        );
      await this.refreshFolders();
      if (
        (this.currentPath || "").startsWith((node.path || "") + "/") ||
        (this.currentPath || "") === (node.path || "")
      ) {
        await this.navigateToFolder("");
      }
      this.showToast({
        title: "Carpeta renombrada",
        message: newName,
        variant: "success",
      });
    } catch (e) {
      try {
        await this.refreshFolders();
      } catch {}
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo renombrar la carpeta",
        variant: "error",
      });
    }
  }

  openDeleteFolderModal(node) {
    const modal = document.getElementById("deleteFolderModal");
    if (!modal) return;
    this.folderToDelete = node;
    const nameEl = document.getElementById("deleteFolderName");
    if (nameEl) nameEl.textContent = node.name || "";
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeDeleteFolderModal() {
    const modal = document.getElementById("deleteFolderModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.folderToDelete = null;
  }

  async confirmDeleteFolderModal() {
    const node = this.folderToDelete;
    if (!node) return;
    try {
      this.closeDeleteFolderModal();
      // UI optimista: eliminar del árbol inmediatamente
      this.removeFolderPathFromTree(node.path || "");
      const qp = new URLSearchParams();
      qp.set("path", node.path || "");
      qp.set("recursive", String(true));
      const res = await fetch(`/api/folder?${qp.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data && data.error) || "No se pudo eliminar la carpeta",
        );
      await this.refreshFolders();
      if (
        (this.currentPath || "").startsWith((node.path || "") + "/") ||
        (this.currentPath || "") === (node.path || "")
      ) {
        await this.navigateToFolder("");
      }
      this.showToast({
        title: "Carpeta eliminada",
        message: node.name,
        variant: "success",
      });
    } catch (e) {
      try {
        await this.refreshFolders();
      } catch {}
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo eliminar la carpeta",
        variant: "error",
      });
    }
  }

  async init() {
    this.setupEventListeners();

    this.checkEnvironment();

    await this.refreshFolders();
    await this.loadFiles();
    // Establecer vista inicial y ocultar sidebar en Inicio
    this.setActiveTab("home");
  }

  showToast({ title, message, variant }) {
    const host = document.getElementById("toastHost");
    if (!host) return;

    const toast = document.createElement("div");
    toast.className = `toast ${variant ? `toast--${variant}` : ""}`.trim();
    toast.innerHTML = `
      <div>
        <strong>${this.escapeHtml(title || "Aviso")}</strong>
        <p>${this.escapeHtml(message || "")}</p>
      </div>
      <button type="button">Cerrar</button>
    `;

    const btn = toast.querySelector("button");
    btn.addEventListener("click", () => toast.remove());

    host.appendChild(toast);

    window.setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 4500);
  }

  setEnvBanner(text) {
    const banner = document.getElementById("envBanner");
    if (!banner) return;

    if (!text) {
      banner.style.display = "none";
      banner.textContent = "";
      return;
    }

    banner.style.display = "block";
    banner.textContent = text;
  }

  async checkEnvironment() {
    if (window.location.protocol === "file:") {
      this.setEnvBanner(
        `Estás abriendo la app como archivo (file://). Para que funcione debes abrirla desde un servidor (local o en Vercel). Ejemplo local: npm install && npm start, y abre http://localhost:3000.`,
      );
      return;
    }

    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (!res.ok || !data || !data.ok) {
        throw new Error((data && data.error) || "Servidor no disponible");
      }
      this.setEnvBanner("");
    } catch (e) {
      const origin = window.location.origin;
      const host = window.location.hostname;
      const isVercel = host.endsWith("vercel.app");
      const isGithub = host.endsWith("github.io");
      this.setEnvBanner(
        isVercel || isGithub
          ? `No se puede conectar al servidor en ${origin}. Revisa que el despliegue esté correcto y que /api/health responda.`
          : "No se puede conectar al servidor. Si estás local: npm install && npm start, luego abre http://localhost:3000",
      );
    }
  }

  setupEventListeners() {
    const uploadBtn = document.getElementById("uploadBtn");
    const dropZone = document.getElementById("dropZone");
    const sortSelect = document.getElementById("sortSelect");
    const menuBtn = document.getElementById("menuBtn");
    const sidebarOverlay = document.getElementById("sidebarOverlay");
    const breadcrumbPath = document.getElementById("breadcrumbPath");
    const homeBtn = document.getElementById("homeBtn");
    const tabHome = document.getElementById("tabHome");
    const tabFolders = document.getElementById("tabFolders");
    const sideTabHome = document.getElementById("sideTabHome");
    const sideTabFolders = document.getElementById("sideTabFolders");
    const backToHomeBtn = document.getElementById("backToHomeBtn");

    const newFolderBtn = document.getElementById("newFolderBtn");
    const folderCreateBtn = document.getElementById("folderCreateBtn");
    const moveConfirmBtn = document.getElementById("moveConfirmBtn");
    const renameFileConfirmBtn = document.getElementById(
      "renameFileConfirmBtn",
    );
    const deleteFileConfirmBtn = document.getElementById(
      "deleteFileConfirmBtn",
    );
    const renameFolderConfirmBtn = document.getElementById(
      "renameFolderConfirmBtn",
    );
    const deleteFolderConfirmBtn = document.getElementById(
      "deleteFolderConfirmBtn",
    );

    const uploadModal = document.getElementById("uploadModal");
    const uploadPreviewArea = document.getElementById("uploadPreviewArea");
    const uploadFileList = document.getElementById("uploadFileList");
    const uploadFileInput = document.getElementById("uploadFileInput");
    const uploadCameraInput = document.getElementById("uploadCameraInput");
    const uploadImageInput = document.getElementById("uploadImageInput");
    const folderSelectTile = document.getElementById("folderSelectTile");
    const folderSelectTileLabel = document.getElementById(
      "folderSelectTileLabel",
    );
    const addMoreBtn = document.getElementById("addMoreBtn");
    const takePhotoBtn = document.getElementById("takePhotoBtn");
    const chooseImageBtn = document.getElementById("chooseImageBtn");
    const uploadConfirmBtn = document.getElementById("uploadConfirmBtn");
    const previewEditBtn = document.getElementById("previewEditBtn");
    const previewSaveBtn = document.getElementById("previewSaveBtn");

    if (uploadBtn)
      uploadBtn.addEventListener("click", () => {
        this.playUiSound("upload");
        this.openUploadModal();
      });

    if (breadcrumbPath) {
      breadcrumbPath.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.matches && t.matches("a[data-path]")) {
          e.preventDefault();
          this.navigateToFolder(t.getAttribute("data-path") || "");
        }
      });
    }

    if (newFolderBtn) {
      newFolderBtn.addEventListener("click", () => {
        this.playUiSound("newFolder");
        this.openFolderModal();
      });
    }
    if (folderCreateBtn) {
      folderCreateBtn.addEventListener("click", async () => {
        await this.confirmCreateFolder();
      });
    }
    if (moveConfirmBtn) {
      moveConfirmBtn.addEventListener("click", async () => {
        await this.confirmMove();
      });
    }
    if (renameFileConfirmBtn) {
      renameFileConfirmBtn.addEventListener("click", async () => {
        await this.confirmRenameFile();
      });
    }
    if (deleteFileConfirmBtn) {
      deleteFileConfirmBtn.addEventListener("click", async () => {
        await this.confirmDeleteFileModal();
      });
    }
    if (renameFolderConfirmBtn) {
      renameFolderConfirmBtn.addEventListener("click", async () => {
        await this.confirmRenameFolderModal();
      });
    }
    if (deleteFolderConfirmBtn) {
      deleteFolderConfirmBtn.addEventListener("click", async () => {
        await this.confirmDeleteFolderModal();
      });
    }

    if (menuBtn) {
      menuBtn.addEventListener("click", () => this.toggleSidebar(true));
    }
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener("click", () => this.toggleSidebar(false));
    }

    if (homeBtn) {
      homeBtn.addEventListener("click", () => this.navigateToFolder(""));
    }

    if (tabHome) {
      tabHome.addEventListener("click", () => this.setActiveTab("home"));
    }
    if (tabFolders) {
      tabFolders.addEventListener("click", () => this.setActiveTab("folders"));
    }
    if (sideTabHome) {
      sideTabHome.addEventListener("click", () => this.setActiveTab("home"));
    }
    if (sideTabFolders) {
      sideTabFolders.addEventListener("click", () =>
        this.setActiveTab("folders"),
      );
    }

    if (backToHomeBtn) {
      backToHomeBtn.addEventListener("click", async () => {
        await this.navigateToFolder("");
      });
    }

    if (dropZone) {
      dropZone.addEventListener("click", () => this.openUploadModal());
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
      });
      dropZone.addEventListener("dragleave", () =>
        dropZone.classList.remove("drag-over"),
      );
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        this.openUploadModal();
        this.setPendingUploadFiles(e.dataTransfer.files, true);
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        this.sortBy = e.target.value;
        this.renderGallery();
      });
    }

    document
      .getElementById("shareBtn")
      .addEventListener("click", () => this.shareFile());
    document
      .getElementById("downloadBtn")
      .addEventListener("click", () => this.downloadFile());

    uploadPreviewArea.addEventListener("click", () => uploadFileInput.click());
    uploadFileInput.addEventListener("change", (e) => {
      const append =
        this.pendingUploadFiles && this.pendingUploadFiles.length > 0;
      this.setPendingUploadFiles(e.target.files, append);
      try {
        e.target.value = "";
      } catch {}
    });
    if (uploadCameraInput) {
      uploadCameraInput.addEventListener("change", (e) => {
        this.setPendingUploadFiles(e.target.files, true);
        try {
          e.target.value = "";
        } catch {}
      });
    }
    if (uploadImageInput) {
      uploadImageInput.addEventListener("change", (e) => {
        this.setPendingUploadFiles(e.target.files, true);
        try {
          e.target.value = "";
        } catch {}
      });
    }
    if (addMoreBtn)
      addMoreBtn.addEventListener("click", () => uploadFileInput.click());
    if (takePhotoBtn)
      takePhotoBtn.addEventListener(
        "click",
        () => uploadCameraInput && uploadCameraInput.click(),
      );
    if (chooseImageBtn)
      chooseImageBtn.addEventListener(
        "click",
        () => uploadImageInput && uploadImageInput.click(),
      );

    uploadPreviewArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploadPreviewArea.classList.add("drag-over");
    });
    uploadPreviewArea.addEventListener("dragleave", () =>
      uploadPreviewArea.classList.remove("drag-over"),
    );
    uploadPreviewArea.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadPreviewArea.classList.remove("drag-over");
      this.setPendingUploadFiles(e.dataTransfer.files, true);
    });

    if (folderSelectTile && uploadFolderSelect) {
      folderSelectTile.addEventListener("click", (e) => {
        e.stopPropagation();
        try {
          uploadFolderSelect.focus();
          uploadFolderSelect.click();
        } catch {}
      });
      uploadFolderSelect.addEventListener("change", () => {
        const val = uploadFolderSelect.value || "";
        if (folderSelectTileLabel)
          folderSelectTileLabel.textContent = val
            ? `/${val}`
            : "Selecciona carpeta";
        // Re-evaluate confirm button state
        this.renderPendingUploadArea();
      });
    }

    if (uploadFileList) {
      uploadFileList.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadFileList.classList.add("drag-over");
      });
      uploadFileList.addEventListener("dragleave", () => {
        uploadFileList.classList.remove("drag-over");
      });
      uploadFileList.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadFileList.classList.remove("drag-over");
        this.setPendingUploadFiles(e.dataTransfer.files, true);
      });
    }

    uploadConfirmBtn.addEventListener("click", async () => {
      if (!uploadModal.classList.contains("active")) return;
      await this.confirmUpload();
    });

    if (previewEditBtn) {
      previewEditBtn.addEventListener("click", () => {
        const info = document.getElementById("previewInfo");
        const isOn = !!(info && info.classList.contains("is-editing"));
        this.setPreviewEditMode(!isOn);
      });
    }

    if (previewSaveBtn) {
      previewSaveBtn.addEventListener("click", async () => {
        await this.savePreviewEdits();
      });
    }

    // Cerrar menú contextual de item al hacer clic fuera
    document.addEventListener("click", (e) => {
      try {
        const t = e.target;
        // Si clic en botón de acciones o dentro del menú, no cerrar aquí
        if (
          t &&
          t.closest &&
          (t.closest(".item-actions") || t.closest(".item-menu"))
        ) {
          return;
        }
      } catch {}
      this.closeActionMenu();
    });
  }

  async refreshFolders() {
    try {
      const res = await fetch("/api/folders");
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data && data.error ? data.error : "Error cargando carpetas",
        );

      this.folderTree = {
        name: "Inicio",
        path: "",
        children: Array.isArray(data.children) ? data.children : [],
      };

      this.applyFolderOrderToTree();

      this.flatFolders = [{ name: "Inicio", path: "" }];
      this.flattenFolders(this.folderTree.children, this.flatFolders);

      this.renderFolderTree();
      this.populateUploadFolderSelect();
      this.updateBreadcrumbs();
    } catch (e) {
      void 0;
      this.showToast({
        title: "No se pudieron cargar carpetas",
        message:
          e && e.message ? e.message : "Revisa que el servidor esté encendido",
        variant: "error",
      });
      this.folderTree = { name: "Inicio", path: "", children: [] };
      this.flatFolders = [{ name: "Inicio", path: "" }];
      this.renderFolderTree();
      this.populateUploadFolderSelect();
    }
  }

  flattenFolders(children, out) {
    for (const node of children) {
      out.push({ name: node.name, path: node.path });
      if (node.children && node.children.length) {
        this.flattenFolders(node.children, out);
      }
    }
  }

  updateFolderNameInTree(targetPath, newName) {
    const rec = (children) => {
      if (!Array.isArray(children)) return false;
      for (const child of children) {
        if ((child.path || "") === (targetPath || "")) {
          child.name = newName;
          return true;
        }
        if (rec(child.children)) return true;
      }
      return false;
    };
    rec(this.folderTree && this.folderTree.children);
    this.renderFolderTree();
  }

  removeFolderPathFromTree(targetPath) {
    const rec = (children) => {
      if (!Array.isArray(children)) return [];
      const next = [];
      for (const child of children) {
        if ((child.path || "") === (targetPath || "")) continue;
        const copy = { ...child };
        copy.children = rec(child.children);
        next.push(copy);
      }
      return next;
    };
    const roots = (this.folderTree && this.folderTree.children) || [];
    this.folderTree = {
      name: "Inicio",
      path: "",
      children: rec(roots),
    };
    this.flatFolders = [{ name: "Inicio", path: "" }];
    this.flattenFolders(this.folderTree.children, this.flatFolders);
    this.renderFolderTree();
  }

  renderFolderTree() {
    const treeContainer = document.getElementById("folderTree");
    if (!treeContainer) return;
    treeContainer.innerHTML = "";

    // Render only actual folders (children of root), not the root itself
    const roots = Array.isArray(this.folderTree.children)
      ? this.folderTree.children
      : [];
    for (const node of roots) {
      treeContainer.appendChild(this.createFolderElement(node));
    }
  }

  createFolderElement(node) {
    const div = document.createElement("div");
    div.className = "tree-item";
    if (node.path === this.currentPath) {
      div.classList.add("active");
    }

    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = this.treeCollapsed.has(node.path);

    div.innerHTML = `
      <div class="tree-left" style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${
          hasChildren
            ? `<button type="button" class="tree-chevron" aria-label="Expandir/colapsar" aria-expanded="${!isCollapsed}">${
                isCollapsed ? "▸" : "▾"
              }</button>`
            : `<span class="tree-chevron--spacer" aria-hidden="true"></span>`
        }
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="tree-name">${this.escapeHtml(node.name)}</span>
      </div>
      <button type="button" class="home-folder__menuBtn tree-menu-btn" aria-label="Acciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>
    `;

    const left = div.querySelector(".tree-left");
    if (left) {
      left.addEventListener("click", (e) => {
        e.stopPropagation();
        this.navigateToFolder(node.path);
      });
    }

    const menuBtn = div.querySelector(".tree-menu-btn");
    const chevBtn = div.querySelector(".tree-chevron");
    if (menuBtn) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openFolderMenu(node, menuBtn);
      });
    }

    if (chevBtn && hasChildren) {
      chevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = node.path || "";
        const collapsed = this.treeCollapsed.has(key);
        if (collapsed) this.treeCollapsed.delete(key);
        else this.treeCollapsed.add(key);
        // Toggle UI
        const childrenContainer = div.querySelector(".tree-children");
        const nowCollapsed = this.treeCollapsed.has(key);
        if (childrenContainer) {
          childrenContainer.style.display = nowCollapsed ? "none" : "block";
        }
        chevBtn.textContent = nowCollapsed ? "▸" : "▾";
        chevBtn.setAttribute("aria-expanded", String(!nowCollapsed));
      });
    }

    // Drag & drop: permitir soltar archivos sobre la carpeta para moverlos
    div.addEventListener("dragover", (e) => {
      try {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      } catch {}
      e.preventDefault();
      div.classList.add("drop-target");
    });
    div.addEventListener("dragleave", () => {
      div.classList.remove("drop-target");
    });
    div.addEventListener("drop", async (e) => {
      e.preventDefault();
      div.classList.remove("drop-target");
      try {
        const filePath = e.dataTransfer.getData("text/plain");
        if (!filePath) return;
        const srcFolder = (filePath || "").split("/").slice(0, -1).join("/");
        if ((srcFolder || "") === (node.path || "")) {
          this.showToast({
            title: "Sin cambios",
            message: `Ya está en ${node.name}`,
            variant: "success",
          });
          return;
        }
        const prevFiles = this.files.slice();
        if ((this.currentPath || "") === (srcFolder || "")) {
          // UI optimista: quitar de la vista actual inmediatamente
          this.files = this.files.filter(
            (f) => (f.path || "") !== (filePath || ""),
          );
          this.renderGallery();
        }
        const res = await fetch("/api/file/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, dest: node.path || "" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error((data && data.error) || "No se pudo mover");
        await this.refreshFolders();
        if ((this.currentPath || "") === (node.path || "")) {
          await this.loadFiles();
        }
        // Mover metadatos locales (descripción)
        try {
          const nameOnly = (filePath || "").split("/").pop() || "";
          const newPath = (node.path ? node.path + "/" : "") + nameOnly;
          this.moveFileMeta(filePath, newPath);
        } catch {}
        // Limpiar caches de Inicio para origen y destino y re-render si estamos en Inicio
        this.homeFolderFiles.delete(node.path || "");
        this.homeFolderFiles.delete(srcFolder || "");
        if (this.isHomeView()) {
          this.renderHomeAccordion();
        }
        this.showToast({
          title: "Movido",
          message: `A ${node.name}`,
          variant: "success",
        });
      } catch (err) {
        try {
          // Revertir UI optimista si falló
          if (Array.isArray(prevFiles)) {
            this.files = prevFiles;
            this.renderGallery();
          }
        } catch {}
        this.showToast({
          title: "Error",
          message: err && err.message ? err.message : "No se pudo mover",
          variant: "error",
        });
      }
    });

    // Menú contextual de carpeta (renombrar / eliminar)
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openFolderMenu(node, div);
    });

    // Tap prolongado en móvil para mostrar menú
    let lpTimer = null;
    const startLP = (e) => {
      try {
        if (e && e.preventDefault) e.preventDefault();
      } catch {}
      lpTimer = window.setTimeout(() => {
        this.openFolderMenu(node, menuBtn || div);
      }, 500);
    };
    const cancelLP = () => {
      if (lpTimer) window.clearTimeout(lpTimer);
      lpTimer = null;
    };
    div.addEventListener("touchstart", startLP, { passive: false });
    div.addEventListener("touchend", cancelLP);
    div.addEventListener("touchmove", cancelLP);

    if (hasChildren) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      const collapsed = this.treeCollapsed.has(node.path || "");
      childrenContainer.style.display = collapsed ? "none" : "block";
      for (const child of node.children) {
        childrenContainer.appendChild(this.createFolderElement(child));
      }
      div.appendChild(childrenContainer);
    }

    return div;
  }

  async navigateToFolder(relPath) {
    this.currentPath = relPath || "";
    this.updateBreadcrumbs();
    await this.loadFiles();
    this.renderFolderTree();
    this.updateFolderToolbar();
  }

  updateBreadcrumbs() {
    const breadcrumbElement = document.getElementById("breadcrumbPath");
    if (!breadcrumbElement) return;
    if (!this.currentPath) {
      breadcrumbElement.innerHTML = `<a href="#" data-path="" style="text-decoration: underline;">Inicio</a>`;
      return;
    }

    const parts = this.currentPath.split("/").filter(Boolean);
    let html = `<a href="#" data-path="" style=\"text-decoration: underline;\">Inicio</a>`;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc += (acc ? "/" : "") + parts[i];
      html += ` <span class="crumb-sep" aria-hidden="true">›</span> <a href="#" data-path="${this.escapeHtml(acc)}" style="text-decoration: underline;">${this.escapeHtml(
        parts[i],
      )}</a>`;
    }
    breadcrumbElement.innerHTML = html;
  }

  async loadFiles() {
    try {
      const qp = new URLSearchParams();
      qp.set("path", this.currentPath || "");
      const res = await fetch(`/api/files?${qp.toString()}`);
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data && data.error ? data.error : "Error cargando archivos",
        );

      this.orderApplied = !!data.orderApplied;
      this.files = Array.isArray(data.files)
        ? data.files.map((f) => ({
            ...f,
            date: f.modified ? new Date(f.modified) : new Date(),
          }))
        : [];

      this.renderGallery();
    } catch (e) {
      void 0;
      this.showToast({
        title: "No se pudieron cargar archivos",
        message:
          e && e.message ? e.message : "Revisa que el servidor esté encendido",
        variant: "error",
      });
      this.files = [];
      this.renderGallery();
    }
  }

  async loadFolderFiles(relPath) {
    const key = relPath || "";
    if (this.homeFolderFiles.has(key)) return this.homeFolderFiles.get(key);

    try {
      const qp = new URLSearchParams();
      qp.set("path", key);
      const res = await fetch(`/api/files?${qp.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data && data.error ? data.error : "Error cargando archivos",
        );
      }

      const files = Array.isArray(data.files)
        ? data.files.map((f) => ({
            ...f,
            date: f.modified ? new Date(f.modified) : new Date(),
          }))
        : [];
      this.homeFolderFiles.set(key, files);
      return files;
    } catch (e) {
      this.homeFolderFiles.set(key, []);
      return [];
    }
  }

  renderGallery() {
    const galleryGrid = document.getElementById("galleryGrid");
    const emptyState = document.getElementById("emptyState");
    const homeAccordion = document.getElementById("homeAccordion");
    this.updateFolderToolbar();

    if (homeAccordion) {
      if (!this.currentPath) {
        homeAccordion.style.display = "block";
        galleryGrid.style.display = "none";
        emptyState.style.display = "none";
        this.renderHomeAccordion();
        return;
      }

      homeAccordion.style.display = "none";
    }

    if (this.files.length === 0) {
      galleryGrid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    galleryGrid.style.display = "block";
    emptyState.style.display = "none";

    // Sort files (respect custom order by default)
    const sortedFiles =
      this.sortBy === "name" || this.sortBy === "date"
        ? [...this.files].sort((a, b) => {
            if (this.sortBy === "name") return a.name.localeCompare(b.name);
            if (this.sortBy === "date") return (b.date || 0) - (a.date || 0);
            return 0;
          })
        : [...this.files];

    galleryGrid.innerHTML = "";

    const videos = sortedFiles.filter((f) => f.type === "video");
    const images = sortedFiles.filter((f) => f.type === "image");

    const makeSection = (title, items) => {
      if (!items.length) return null;
      const section = document.createElement("div");
      section.className = "home-section";

      const header = document.createElement("div");
      header.className = "home-section__header is-static";
      header.innerHTML = `
        <span class="home-section__title">${this.escapeHtml(title)}</span>
        <span class="home-section__meta">${items.length} archivo(s)</span>
      `;

      const body = document.createElement("div");
      body.className = "home-section__body";
      body.style.display = "block";

      const grid = document.createElement("div");
      grid.className = "home-section__grid";
      for (const it of items) {
        grid.appendChild(this.createGalleryItem(it));
      }
      this.setupGridDnD(grid);
      body.appendChild(grid);

      section.appendChild(header);
      section.appendChild(body);
      return section;
    };

    const videosSection = makeSection("Videos", videos);
    if (videosSection) galleryGrid.appendChild(videosSection);
    const imagesSection = makeSection("Imágenes", images);
    if (imagesSection) galleryGrid.appendChild(imagesSection);
  }

  createGalleryItem(file) {
    const div = document.createElement("div");
    div.className = "gallery-item";
    if (file.type === "video") {
      div.classList.add("is-video");
    }
    // Datos para acciones y orden
    div.dataset.filename = file.name;
    div.dataset.filepath = file.path || "";
    const allowDnD = !this.isHomeView();
    div.setAttribute("draggable", allowDnD ? "true" : "false");
    if (allowDnD) {
      div.addEventListener("dragstart", (e) => {
        this.draggingEl = div;
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", file.path || "");
        } catch {}
        div.classList.add("dragging");
      });
      div.addEventListener("dragend", () => {
        div.classList.remove("dragging");
        this.draggingEl = null;
      });
    }

    const mediaElement =
      file.type === "video"
        ? `<video src="${file.url}" autoplay muted loop playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain;object-position:center"></video>`
        : `<img src="${file.url}" alt="${this.escapeHtml(file.name)}" style="width:100%;height:100%;object-fit:contain;object-position:center">`;

    const videoIndicator =
      file.type === "video"
        ? `<div class="video-indicator">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Video
               </div>`
        : "";

    const fileNameHtml =
      file.type === "video"
        ? ""
        : `<div class="file-name">${this.escapeHtml(file.name)}</div>`;

    const actionsHtml = `
      <div class="item-actions">
        <button class="item-actions__btn" type="button" aria-label="Editar o gestionar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="1"></circle>
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="12" cy="19" r="1"></circle>
          </svg>
        </button>
      </div>`;

    div.innerHTML = `${actionsHtml}${mediaElement}${videoIndicator}${fileNameHtml}`;

    div.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.closest && t.closest(".item-actions")) {
        return; // Click en acciones no debe abrir preview
      }
      this.openPreview(file);
    });

    // Acciones por ícono (en todas las vistas)
    const btn = div.querySelector(".item-actions__btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openItemMenu(file, btn);
      });
    }
    // Context menu (right-click)
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const anchor = div.querySelector(".item-actions__btn") || div;
      this.openItemMenu(file, anchor);
    });

    // Long press (mobile)
    let lpTimer = null;
    const startLP = (e) => {
      try {
        if (e && e.preventDefault) e.preventDefault();
      } catch {}
      lpTimer = window.setTimeout(() => {
        const anchor = div.querySelector(".item-actions__btn") || div;
        this.openItemMenu(file, anchor);
      }, 500);
    };
    const cancelLP = () => {
      if (lpTimer) window.clearTimeout(lpTimer);
      lpTimer = null;
    };
    div.addEventListener("touchstart", startLP, { passive: false });
    div.addEventListener("touchend", cancelLP);
    div.addEventListener("touchmove", cancelLP);

    return div;
  }

  // Menú contextual por item (renombrar, mover, eliminar)
  openItemMenu(file, anchorEl) {
    this.closeActionMenu();
    const menu = document.createElement("div");
    menu.className = "item-menu";
    menu.innerHTML = `
      <button type="button" class="item-menu__item" data-action="rename">Renombrar</button>
      <button type="button" class="item-menu__item" data-action="move">Mover de carpeta</button>
      <button type="button" class="item-menu__item item-menu__item--danger" data-action="delete">Eliminar</button>
    `;
    document.body.appendChild(menu);

    // Posicionar cerca del botón
    const r = anchorEl.getBoundingClientRect();
    const top = Math.round(window.scrollY + r.bottom + 8);
    const left = Math.round(window.scrollX + r.right - 160);
    menu.style.position = "absolute";
    menu.style.top = top + "px";
    menu.style.left = left + "px";

    menu.addEventListener("click", async (e) => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const action = t.getAttribute("data-action");
      if (!action) return;
      if (action === "rename") this.openRenameFileModal(file);
      else if (action === "move") this.openMoveModal(file);
      else if (action === "delete") this.openDeleteFileModal(file);
      this.closeActionMenu();
    });

    this.activeActionMenu = menu;
  }

  closeActionMenu() {
    if (this.activeActionMenu && this.activeActionMenu.remove) {
      this.activeActionMenu.remove();
    }
    this.activeActionMenu = null;
  }

  openFolderMenu(node, anchorEl) {
    this.closeActionMenu();
    const menu = document.createElement("div");
    menu.className = "item-menu";
    menu.innerHTML = `
      <button type="button" class="item-menu__item" data-action="open-folder">Abrir carpeta</button>
      <button type="button" class="item-menu__item" data-action="rename-folder">Renombrar carpeta</button>
      <button type="button" class="item-menu__item" data-action="move-down">Mover abajo</button>
      <button type="button" class="item-menu__item" data-action="move-up">Mover arriba</button>
      <button type="button" class="item-menu__item item-menu__item--danger" data-action="delete-folder">Eliminar carpeta</button>
    `;
    document.body.appendChild(menu);

    const r = anchorEl.getBoundingClientRect();
    const top = Math.round(window.scrollY + r.top);
    const left = Math.round(window.scrollX + r.right + 8);
    menu.style.position = "absolute";
    menu.style.top = top + "px";
    menu.style.left = left + "px";

    menu.addEventListener("click", async (e) => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const action = t.getAttribute("data-action");
      if (action === "open-folder")
        await this.navigateToFolder(node.path || "");
      else if (action === "rename-folder") this.openRenameFolderModal(node);
      else if (action === "move-up") this.reorderSibling(node.path || "", -1);
      else if (action === "move-down") this.reorderSibling(node.path || "", +1);
      else if (action === "delete-folder") this.openDeleteFolderModal(node);
      this.closeActionMenu();
    });

    this.activeActionMenu = menu;
  }

  async promptRenameFolder(node) {
    try {
      const input = window.prompt("Nuevo nombre de carpeta", node.name || "");
      if (input === null) return;
      const newName = String(input).trim();
      if (!newName) return;
      const res = await fetch("/api/folder/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.path || "", newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data && data.error) || "No se pudo renombrar la carpeta",
        );
      await this.refreshFolders();
      if (
        (this.currentPath || "").startsWith(node.path + "/") ||
        (this.currentPath || "") === node.path
      ) {
        // Si renombramos la carpeta actual o ancestro, navegar a Inicio para evitar incoherencias
        await this.navigateToFolder("");
      }
      this.showToast({
        title: "Carpeta renombrada",
        message: newName,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo renombrar la carpeta",
        variant: "error",
      });
    }
  }

  async confirmDeleteFolder(node) {
    try {
      const recursive = true;
      const ok = window.confirm(
        `¿Eliminar carpeta "${node.name}" y su contenido?`,
      );
      if (!ok) return;
      const qp = new URLSearchParams();
      qp.set("path", node.path || "");
      qp.set("recursive", String(recursive));
      const res = await fetch(`/api/folder?${qp.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (data && data.error) || "No se pudo eliminar la carpeta",
        );
      await this.refreshFolders();
      if (
        (this.currentPath || "").startsWith((node.path || "") + "/") ||
        (this.currentPath || "") === (node.path || "")
      ) {
        await this.navigateToFolder("");
      }
      this.showToast({
        title: "Carpeta eliminada",
        message: node.name,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo eliminar la carpeta",
        variant: "error",
      });
    }
  }

  async promptRenameFile(file) {
    try {
      const parts = this.splitFileName(file.name);
      const base = parts.base;
      const ext = parts.ext || "";
      const input = window.prompt("Nuevo nombre del archivo", base);
      if (!input && input !== "") return;
      const newBase = String(input).trim();
      if (!newBase) return;
      const newName = newBase + ext;
      const res = await fetch("/api/file/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data && data.error) || "No se pudo renombrar");
      await this.loadFiles();
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderFolderTree();
      this.showToast({
        title: "Renombrado",
        message: newName,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo renombrar",
        variant: "error",
      });
    }
  }

  async confirmDeleteFile(file) {
    try {
      const ok = window.confirm(`¿Eliminar "${file.name}"?`);
      if (!ok) return;
      const qp = new URLSearchParams();
      qp.set("path", file.path);
      const res = await fetch(`/api/file?${qp.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data && data.error) || "No se pudo eliminar");
      await this.loadFiles();
      this.homeFolderFiles.delete(this.currentPath || "");
      this.renderFolderTree();
      this.showToast({
        title: "Eliminado",
        message: file.name,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo eliminar",
        variant: "error",
      });
    }
  }

  async promptMoveFile(file) {
    try {
      // Prompt simple para destino (vacío = Inicio). También puedes arrastrar sobre la carpeta en el árbol.
      const dest = window.prompt(
        "Mover a carpeta (ruta relativa, vacío = Inicio):",
        "",
      );
      if (dest === null) return;
      const res = await fetch("/api/file/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, dest: String(dest || "") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data && data.error) || "No se pudo mover");
      await this.refreshFolders();
      if ((this.currentPath || "") === String(dest || ""))
        await this.loadFiles();
      else await this.loadFiles();
      this.showToast({
        title: "Movido",
        message: `${file.name}`,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo mover",
        variant: "error",
      });
    }
  }

  setupGridDnD(grid) {
    if (!grid) return;
    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = this.getDragAfterElement(grid, e.clientY);
      const dragging = this.draggingEl;
      if (!dragging) return;
      if (!after) grid.appendChild(dragging);
      else grid.insertBefore(dragging, after);
    });
    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      this.saveCurrentOrder();
    });
  }

  getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll(".gallery-item:not(.dragging)")];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const child of els) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: child };
      }
    }
    return closest.element;
  }

  async saveCurrentOrder() {
    if (!this.currentPath) return;
    try {
      const items = Array.from(
        document.querySelectorAll(
          "#galleryGrid .home-section__grid .gallery-item",
        ),
      );
      const order = items
        .map((el) => el.dataset && el.dataset.filename)
        .filter(Boolean);
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: this.currentPath || "", order }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data && data.error) || "No se pudo guardar el orden");
      this.showToast({
        title: "Orden guardado",
        message: `${order.length} elemento(s)`,
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo guardar el orden",
        variant: "error",
      });
    }
  }

  openPreview(file) {
    const modal = document.getElementById("previewModal");
    const container = document.getElementById("previewContainer");
    const fileName = document.getElementById("previewFileName");
    const filePath = document.getElementById("previewFilePath");
    const fileDate = document.getElementById("previewFileDate");
    const fileSize = document.getElementById("previewFileSize");

    // Set file info
    fileName.textContent = file.name;
    filePath.textContent = this.currentPath
      ? `${this.currentPath}/${file.name}`
      : file.name;
    fileDate.textContent = (file.date || new Date()).toLocaleDateString(
      "es-ES",
    );
    fileSize.textContent = this.formatFileSize(file.size);

    // Set media content
    if (file.type === "video") {
      container.innerHTML = `<video src="${file.url}" controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain;object-position:center"></video>`;
    } else {
      container.innerHTML = `<img src="${file.url}" alt="${this.escapeHtml(file.name)}" style="width:100%;height:100%;object-fit:contain;object-position:center">`;
    }

    // Rellenar edición de nombre y descripción
    const nameInput = document.getElementById("previewNameInput");
    const nameExt = document.getElementById("previewNameExt");
    const descInput = document.getElementById("previewDescInput");
    const parts = this.splitFileName(file.name);
    if (nameInput) nameInput.value = parts.base || "";
    if (nameExt) nameExt.textContent = parts.ext || "";
    const meta = this.getFileMeta(file.path || "");
    const metaDesc = (meta && meta.description) || "";
    if (descInput) descInput.value = metaDesc;
    const descBlock = document.getElementById("previewDescBlock");
    const descText = document.getElementById("previewDescText");
    if (descText) descText.textContent = metaDesc;
    // Show description block for all files (not just videos)
    if (descBlock) descBlock.style.display = "block";

    // Store current file for sharing/downloading
    this.currentPreviewFile = file;

    // Ensure edit UI starts hidden
    this.setPreviewEditMode(false);

    // Show modal
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closePreview() {
    const modal = document.getElementById("previewModal");
    modal.classList.remove("active");
    document.body.style.overflow = "";
    // Reset edit mode when closing
    this.setPreviewEditMode(false);

    // Stop video if playing
    const video = document.querySelector("#previewContainer video");
    if (video) {
      video.pause();
    }
  }

  async shareFile() {
    if (!this.currentPreviewFile) return;

    try {
      if (navigator.share) {
        // Prefer native share sheet when available
        if (navigator.canShare) {
          // Try to share as file
          try {
            const response = await fetch(this.currentPreviewFile.url);
            const blob = await response.blob();
            const shareFile = new File([blob], this.currentPreviewFile.name, {
              type: blob.type || "",
            });
            if (navigator.canShare({ files: [shareFile] })) {
              await navigator.share({
                title: this.currentPreviewFile.name,
                text: `Compartido desde PCU Media - ${this.currentPreviewFile.name}`,
                files: [shareFile],
              });
              return;
            }
          } catch (_) {
            // ignore and fallback to URL share
          }
        }
        // Fallback: share URL/text (works when canShare is missing)
        await navigator.share({
          title: this.currentPreviewFile.name,
          text: `Compartido desde PCU Media - ${this.currentPreviewFile.name}`,
          url: this.currentPreviewFile.url,
        });
      } else {
        // No Web Share API: fallback to download
        this.downloadFile();
      }
    } catch (error) {
      void 0;
      // Fallback to download
      this.downloadFile();
    }
  }

  downloadFile() {
    if (!this.currentPreviewFile) return;
    const doDirect = () => {
      const link = document.createElement("a");
      link.href = this.currentPreviewFile.url;
      link.download = this.currentPreviewFile.name;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    // Prefer blob download to enforce save dialog
    (async () => {
      try {
        const res = await fetch(this.currentPreviewFile.url);
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = this.currentPreviewFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      } catch (_) {
        doDirect();
      }
    })();
  }

  openUploadModal() {
    const modal = document.getElementById("uploadModal");
    modal.classList.add("active");
    document.body.style.overflow = "hidden";

    this.populateUploadFolderSelect();
    this.setPendingUploadFiles([], false);

    const uploadFolderSelect = document.getElementById("uploadFolderSelect");
    const initialDest = this.currentPath || "";
    if (initialDest) {
      uploadFolderSelect.value = initialDest;
    } // else keep placeholder selected
    const folderSelectTileLabel = document.getElementById(
      "folderSelectTileLabel",
    );
    if (folderSelectTileLabel)
      folderSelectTileLabel.textContent = uploadFolderSelect.value
        ? `/${uploadFolderSelect.value}`
        : "Selecciona carpeta";

    const uploadConfirmBtn = document.getElementById("uploadConfirmBtn");
    if (uploadConfirmBtn) {
      uploadConfirmBtn.disabled = true;
      uploadConfirmBtn.textContent = "Subir";
    }
  }

  closeUploadModal() {
    const modal = document.getElementById("uploadModal");
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.setPendingUploadFiles([]);

    const uploadFileInput = document.getElementById("uploadFileInput");
    uploadFileInput.value = "";
    const uploadCameraInput = document.getElementById("uploadCameraInput");
    if (uploadCameraInput) uploadCameraInput.value = "";
    const uploadImageInput = document.getElementById("uploadImageInput");
    if (uploadImageInput) uploadImageInput.value = "";
  }

  openFolderModal() {
    const modal = document.getElementById("folderModal");
    if (!modal) return;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";

    this.populateFolderParentSelect();
    const parent = document.getElementById("folderParentSelect");
    if (parent) parent.value = this.currentPath || "";

    const name = document.getElementById("folderNameInput");
    if (name) {
      name.value = "";
      window.setTimeout(() => name.focus(), 30);
    }
  }

  closeFolderModal() {
    const modal = document.getElementById("folderModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }

  openMoveModal(file) {
    const modal = document.getElementById("moveModal");
    if (!modal) return;
    this.fileToMove = file;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
    this.populateMoveFolderSelect();
    const select = document.getElementById("moveFolderSelect");
    if (select) {
      const currentFolder = (file.path || "").split("/").slice(0, -1).join("/");
      let defaultDest = this.currentPath || currentFolder || "";
      if (Array.isArray(this.flatFolders) && this.flatFolders.length > 1) {
        const alt = this.flatFolders.find(
          (f) => (f.path || "") !== (currentFolder || ""),
        );
        if (alt) defaultDest = alt.path || "";
      }
      select.value = defaultDest;
    }
  }

  closeMoveModal() {
    const modal = document.getElementById("moveModal");
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
    this.fileToMove = null;
  }

  populateMoveFolderSelect() {
    const select = document.getElementById("moveFolderSelect");
    if (!select) return;
    select.innerHTML = "";
    for (const folder of this.flatFolders) {
      const opt = document.createElement("option");
      opt.value = folder.path;
      opt.textContent = folder.path ? `/${folder.path}` : "Inicio";
      select.appendChild(opt);
    }
  }

  async confirmMove() {
    const select = document.getElementById("moveFolderSelect");
    const dest = select ? String(select.value || "") : "";
    const file = this.fileToMove;
    if (!file) return;
    try {
      const srcFolder = (file.path || "").split("/").slice(0, -1).join("/");
      if ((dest || "") === (srcFolder || "")) {
        this.closeMoveModal();
        this.showToast({
          title: "Sin cambios",
          message: "El archivo ya está en esa carpeta",
          variant: "success",
        });
        return;
      }
      const overwriteEl = document.getElementById("moveOverwrite");
      const overwrite = !!(overwriteEl && overwriteEl.checked);
      const prevFiles = this.files.slice();
      this.closeMoveModal();
      this.files = this.files.filter(
        (f) => (f.path || "") !== (file.path || ""),
      );
      this.renderGallery();

      const res = await fetch("/api/file/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, dest, overwrite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data && data.error) || "No se pudo mover");
      await this.refreshFolders();
      await this.loadFiles();
      // Mover metadatos locales (descripción)
      try {
        const newPath = (dest ? dest + "/" : "") + file.name;
        this.moveFileMeta(file.path, newPath);
        // Actualizar referencia
        file.path = newPath;
      } catch {}
      // Actualizar caches de Inicio para que no se duplique el archivo
      this.homeFolderFiles.delete(dest || "");
      this.homeFolderFiles.delete(srcFolder || "");
      if (this.isHomeView()) {
        this.renderHomeAccordion();
      }
      this.showToast({
        title: "Movido",
        message: `${file.name}`,
        variant: "success",
      });
    } catch (e) {
      try {
        if (Array.isArray(prevFiles)) {
          this.files = prevFiles;
          this.renderGallery();
        }
      } catch {}
      this.showToast({
        title: "Error",
        message: e && e.message ? e.message : "No se pudo mover",
        variant: "error",
      });
    }
  }

  populateFolderParentSelect() {
    const select = document.getElementById("folderParentSelect");
    if (!select) return;

    select.innerHTML = "";
    for (const folder of this.flatFolders) {
      const opt = document.createElement("option");
      opt.value = folder.path;
      opt.textContent = folder.path ? `/${folder.path}` : "Inicio";
      select.appendChild(opt);
    }
  }

  async confirmCreateFolder() {
    const parentEl = document.getElementById("folderParentSelect");
    const nameEl = document.getElementById("folderNameInput");
    const btn = document.getElementById("folderCreateBtn");
    if (!nameEl || !btn) return;

    const parent = parentEl ? String(parentEl.value || "") : "";
    const name = String(nameEl.value || "").trim();

    if (!name) {
      this.showToast({
        title: "Falta el nombre",
        message: "Escribe el nombre de la carpeta.",
        variant: "error",
      });
      nameEl.focus();
      return;
    }

    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creando...";

    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data && data.error ? data.error : "No se pudo crear la carpeta",
        );
      }

      this.showToast({
        title: "Carpeta creada",
        message: `Se creó: ${name}`,
        variant: "success",
      });

      this.closeFolderModal();
      await this.refreshFolders();
      this.homeFolderFiles.clear();
      if (!this.currentPath) {
        this.renderHomeAccordion();
      }
    } catch (e) {
      this.showToast({
        title: "No se pudo crear",
        message: e && e.message ? e.message : "Error creando carpeta",
        variant: "error",
      });
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }

  renderHomeAccordion() {
    const host = document.getElementById("homeAccordion");
    if (!host) return;

    const nodes = [];
    const children = (this.folderTree && this.folderTree.children) || [];
    nodes.push(...children);
    const emptyState = document.getElementById("emptyState");
    if (emptyState) emptyState.style.display = "none";

    host.innerHTML = "";
    for (const node of nodes) {
      host.appendChild(this.createHomeFolderNode(node, 0));
    }
  }

  createHomeFolderNode(node, depth) {
    const wrap = document.createElement("div");
    wrap.className = "home-folder";

    const isCollapsed = this.homeCollapsed.has(node.path);
    const pad = 12 + depth * 18;

    wrap.innerHTML = `
      <button type="button" class="home-folder__row" aria-expanded="${!isCollapsed}" style="padding-left: ${pad}px">
        <span class="home-folder__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <span class="home-folder__name">${this.escapeHtml(node.name)}</span>
        <span class="home-folder__meta"></span>
      </button>
      <div class="home-folder__body" style="display: ${isCollapsed ? "none" : "block"}">
        <div class="home-folder__children"></div>
        <div class="home-folder__files"></div>
      </div>
    `;

    const row = wrap.querySelector(".home-folder__row");
    const body = wrap.querySelector(".home-folder__body");
    const meta = wrap.querySelector(".home-folder__meta");
    const childrenEl = wrap.querySelector(".home-folder__children");
    const filesEl = wrap.querySelector(".home-folder__files");

    row.addEventListener("click", async () => {
      // En Inicio: NO entrar; solo expandir/colapsar acordeón
      const collapsed = this.homeCollapsed.has(node.path);
      if (collapsed) this.homeCollapsed.delete(node.path);
      else this.homeCollapsed.add(node.path);

      const nowCollapsed = this.homeCollapsed.has(node.path);
      body.style.display = nowCollapsed ? "none" : "block";
      row.setAttribute("aria-expanded", String(!nowCollapsed));

      if (!nowCollapsed) {
        await this.renderHomeFolderBody(node, filesEl, childrenEl, meta, depth);
      }
    });

    // Abrir menú contextual con clic derecho en desktop
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openFolderMenu(node, row);
    });

    // Tap prolongado en móvil para abrir menú contextual
    let lpTimer = null;
    const startLP = (e) => {
      try {
        if (e && e.preventDefault) e.preventDefault();
      } catch {}
      lpTimer = window.setTimeout(() => {
        this.openFolderMenu(node, row);
      }, 550);
    };
    const cancelLP = () => {
      if (lpTimer) window.clearTimeout(lpTimer);
      lpTimer = null;
    };
    row.addEventListener("touchstart", startLP, { passive: false });
    row.addEventListener("touchend", cancelLP);
    row.addEventListener("touchmove", cancelLP);

    // Siempre cargar metadatos (conteos) y contenido, aunque el cuerpo esté oculto si está colapsado
    this.renderHomeFolderBody(node, filesEl, childrenEl, meta, depth);

    return wrap;
  }

  async renderHomeFolderBody(node, filesEl, childrenEl, metaEl, depth) {
    if (!filesEl || !childrenEl) return;

    filesEl.innerHTML = `<div class="home-loading">Cargando...</div>`;
    childrenEl.innerHTML = "";

    const files = await this.loadFolderFiles(node.path);
    const vCount = files.filter((f) => f.type === "video").length;
    const iCount = files.filter((f) => f.type === "image").length;
    if (metaEl)
      metaEl.textContent = `${vCount} video(s) · ${iCount} imagen(es) · Total ${files.length}`;

    if (!files.length) {
      filesEl.innerHTML = `<div class="home-empty">Sin archivos</div>`;
    } else {
      filesEl.innerHTML = "";
      const grid = document.createElement("div");
      grid.className = "home-files-grid";
      const list = this.isHomeView() ? files.slice(0, 6) : files;
      for (const f of list) {
        const item = this.createGalleryItem(f);
        item.classList.add("home-item");
        grid.appendChild(item);
      }
      filesEl.appendChild(grid);
    }

    const kids = Array.isArray(node.children) ? node.children : [];
    if (kids.length) {
      for (const child of kids) {
        childrenEl.appendChild(this.createHomeFolderNode(child, depth + 1));
      }
    }
  }

  loadFolderOrder() {
    try {
      const raw = window.localStorage.getItem("pcu_folder_order");
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  saveFolderOrder() {
    try {
      window.localStorage.setItem(
        "pcu_folder_order",
        JSON.stringify(this.customFolderOrder || {}),
      );
    } catch (_) {}
  }

  applyFolderOrderToTree() {
    const rec = (parentPath, children) => {
      if (!Array.isArray(children) || !children.length) return children || [];
      const key = String(parentPath || "");
      const order =
        (this.customFolderOrder && this.customFolderOrder[key]) || [];
      const idx = new Map();
      order.forEach((p, i) => idx.set(String(p), i));
      const sorted = [...children].sort((a, b) => {
        const ai = idx.has(a.path) ? idx.get(a.path) : Number.POSITIVE_INFINITY;
        const bi = idx.has(b.path) ? idx.get(b.path) : Number.POSITIVE_INFINITY;
        if (ai !== bi) return ai - bi;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      for (const child of sorted) {
        child.children = rec(child.path || "", child.children);
      }
      return sorted;
    };
    const roots = (this.folderTree && this.folderTree.children) || [];
    this.folderTree.children = rec("", roots);
  }

  findParentAndIndex(targetPath) {
    const rec = (parent, children) => {
      if (!Array.isArray(children)) return null;
      for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if ((ch.path || "") === (targetPath || "")) {
          return { parent, index: i };
        }
        const found = rec(ch, ch.children);
        if (found) return found;
      }
      return null;
    };
    return rec(
      { path: "", children: this.folderTree.children },
      this.folderTree.children,
    );
  }

  reorderSibling(targetPath, direction) {
    const info = this.findParentAndIndex(targetPath);
    if (!info) return;
    const parent = info.parent;
    const i = info.index;
    const arr = parent.children || [];
    const j = i + (direction < 0 ? -1 : 1);
    if (j < 0 || j >= arr.length) return;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;

    const key = String(parent.path || "");
    this.customFolderOrder = this.customFolderOrder || {};
    this.customFolderOrder[key] = (arr || []).map((n) => String(n.path || ""));
    this.saveFolderOrder();

    // Recalcular estructuras derivadas
    this.flatFolders = [{ name: "Inicio", path: "" }];
    this.flattenFolders(this.folderTree.children, this.flatFolders);
    this.renderFolderTree();
    if (!this.currentPath) this.renderHomeAccordion();
  }

  populateUploadFolderSelect() {
    const select = document.getElementById("uploadFolderSelect");
    if (!select) return;

    select.innerHTML = "";
    // Placeholder (not a valid destination)
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona carpeta...";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    // Only real folders (exclude root "Inicio")
    for (const folder of this.flatFolders) {
      if (!folder.path) continue; // skip root
      const opt = document.createElement("option");
      opt.value = folder.path;
      opt.textContent = `/${folder.path}`;
      select.appendChild(opt);
    }
  }

  setPendingUploadFiles(fileList, append = false) {
    try {
      if (!append && Array.isArray(this.pendingUploadObjectUrls)) {
        for (const u of this.pendingUploadObjectUrls) {
          try {
            if (u) URL.revokeObjectURL(u);
          } catch {}
        }
      }
    } catch {}

    const incoming = Array.from(fileList || []).filter((f) => {
      return (
        f.type && (f.type.startsWith("image/") || f.type.startsWith("video/"))
      );
    });

    let files;
    let names;
    let urls;
    let descs;
    if (
      append &&
      Array.isArray(this.pendingUploadFiles) &&
      this.pendingUploadFiles.length
    ) {
      files = this.pendingUploadFiles.concat(incoming);
      names = this.pendingUploadNames.concat(
        incoming.map((f) => this.splitFileName(f.name).base),
      );
      urls = (this.pendingUploadObjectUrls || []).concat(
        incoming.map((f) => URL.createObjectURL(f)),
      );
      descs = (this.pendingUploadDescs || []).concat(incoming.map(() => ""));
    } else {
      files = incoming;
      names = incoming.map((f) => this.splitFileName(f.name).base);
      urls = incoming.map((f) => URL.createObjectURL(f));
      descs = incoming.map(() => "");
    }

    this.pendingUploadFiles = files;
    this.pendingUploadNames = names;
    this.pendingUploadObjectUrls = urls;
    this.pendingUploadDescs = descs;
    this.renderPendingUploadArea();
  }

  renderPendingUploadArea() {
    const area = document.getElementById("uploadPreviewArea");
    const host = document.getElementById("uploadFileList");
    const confirmBtn = document.getElementById("uploadConfirmBtn");
    const uploadFolderSelect = document.getElementById("uploadFolderSelect");
    const hasDest = !!(uploadFolderSelect && uploadFolderSelect.value);
    if (!area || !host || !confirmBtn) return;
    const files = this.pendingUploadFiles || [];

    // Keep the original dropzone markup intact (icon + label)

    if (files.length === 0) {
      host.innerHTML = "";
      confirmBtn.disabled = true;
      return;
    }

    // Disable confirm if no destination is selected yet
    confirmBtn.disabled = !hasDest;
    const list = document.createElement("div");
    list.className = "selected-files-list";
    files.forEach((f, i) => {
      const item = document.createElement("div");
      item.className = "selected-file-item";
      const parts = this.splitFileName(f.name);
      const url = this.pendingUploadObjectUrls[i];
      const isImg = (f.type || "").startsWith("image/");
      const mediaHtml = isImg
        ? `<img class="selected-file-thumb" src="${url}" alt="${this.escapeHtml(parts.base)}" style="width:100%;height:100%;object-fit:contain;object-position:center" />`
        : `<video class="selected-file-thumb" src="${url}" autoplay loop muted playsinline style="width:100%;height:100%;object-fit:contain;object-position:center"></video>`;
      const titleVal = this.escapeHtml(
        this.pendingUploadNames[i] || parts.base,
      );
      const descVal = this.escapeHtml(this.pendingUploadDescs[i] || "");
      item.innerHTML = `
        <div class="selected-file-thumbwrap">
          ${mediaHtml}
          <button type="button" class="selected-file-remove" aria-label="Quitar">×</button>
        </div>
        <div class="selected-file-meta">
          <input type="text" class="selected-file-title" value="${titleVal}" aria-label="Título" />
          <span class="selected-file-ext">${this.escapeHtml(parts.ext)}</span>
          <textarea class="selected-file-desc" rows="2" placeholder="Descripción opcional">${descVal}</textarea>
        </div>
      `;
      // Open preview when clicking on the thumbnail area
      const thumbwrap = item.querySelector(".selected-file-thumbwrap");
      if (thumbwrap) {
        thumbwrap.style.cursor = "pointer";
        thumbwrap.addEventListener("click", (e) => {
          e.stopPropagation();
          const isVideo = (f.type || "").startsWith("video/");
          const previewFile = {
            name: f.name,
            url: url,
            size: f.size || 0,
            date: new Date(),
            path: "",
            type: isVideo ? "video" : "image",
          };
          this.openPreview(previewFile);
        });
      }
      const input = item.querySelector(".selected-file-title");
      if (input) {
        input.addEventListener("input", (e) => {
          this.pendingUploadNames[i] = e.target.value;
        });
        input.addEventListener("click", (e) => e.stopPropagation());
      }
      const desc = item.querySelector(".selected-file-desc");
      if (desc) {
        desc.addEventListener("input", (e) => {
          this.pendingUploadDescs[i] = e.target.value;
        });
        desc.addEventListener("click", (e) => e.stopPropagation());
      }
      const rm = item.querySelector(".selected-file-remove");
      if (rm) {
        rm.addEventListener("click", (e) => {
          e.stopPropagation();
          try {
            const urlToRevoke = this.pendingUploadObjectUrls[i];
            if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
          } catch {}
          this.pendingUploadFiles.splice(i, 1);
          this.pendingUploadNames.splice(i, 1);
          this.pendingUploadObjectUrls.splice(i, 1);
          this.pendingUploadDescs.splice(i, 1);
          this.renderPendingUploadArea();
        });
      }
      list.appendChild(item);
    });
    host.innerHTML = "";
    host.appendChild(list);
  }

  async confirmUpload() {
    const uploadFolderSelect = document.getElementById("uploadFolderSelect");
    let dest = (uploadFolderSelect && uploadFolderSelect.value) || "";
    const btn = document.getElementById("uploadConfirmBtn");
    if (!this.pendingUploadFiles.length) return;

    btn.disabled = true;

    // Copiar datos antes de cerrar modal
    const filesToUpload = this.pendingUploadFiles.slice();
    const namesToUpload = this.pendingUploadNames.slice();
    const descsToUpload = this.pendingUploadDescs.slice();
    const fileCount = filesToUpload.length;

    // Cerrar modal de inmediato
    this.closeUploadModal();

    // Navegar a la carpeta destino
    if ((dest || "") !== (this.currentPath || "")) {
      this.currentPath = dest || "";
      this.updateBreadcrumbs();
      this.renderFolderTree();
      this.updateFolderToolbar();
    }

    try {
      for (var i = 0; i < fileCount; i++) {
        var f = filesToUpload[i];
        var parts = this.splitFileName(f.name);
        var base = String(namesToUpload[i] || "").trim() || parts.base;
        var newName = base + parts.ext;
        var fileName = Date.now() + "_" + newName;
        var filePath = dest ? dest + "/" + fileName : fileName;

        // Subir directo a Firebase Storage desde el navegador
        var sRef = window.fbRef(window.fbStorage, filePath);
        var snapshot = await window.fbUploadBytes(sRef, f, {
          contentType: f.type || "application/octet-stream",
        });
        var downloadURL = await window.fbGetDownloadURL(snapshot.ref);

        // Registrar metadata en Firestore via API
        await fetch("/api/register-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName,
            path: filePath,
            url: downloadURL,
            size: f.size,
            mimetype: f.type || "application/octet-stream",
            folder: dest,
          }),
        });

        // Guardar descripcion local
        this.setFileMeta(filePath, { description: descsToUpload[i] || "" });
      }

      // Refrescar galeria con los archivos reales
      await this.refreshFolders();
      this.homeFolderFiles.delete(dest || "");
      await this.loadFiles();

      this.showToast({
        title: "Listo",
        message: fileCount + " archivo(s) subido(s).",
        variant: "success",
      });
    } catch (e) {
      this.showToast({
        title: "No se pudo subir",
        message: e && e.message ? e.message : "Error subiendo archivos",
        variant: "error",
      });
      await this.loadFiles();
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  splitFileName(name) {
    const s = String(name || "");
    const idx = s.lastIndexOf(".");
    if (idx <= 0) return { base: s, ext: "" };
    return { base: s.slice(0, idx), ext: s.slice(idx) };
  }

  playUiSound(kind) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.audioCtx) this.audioCtx = new AC();
      const ctx = this.audioCtx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const t0 = ctx.currentTime;
      const dur = 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "upload" ? "triangle" : "sine";

      // Pitch envelope per action
      const startF = kind === "upload" ? 420 : 560;
      const endF = kind === "upload" ? 640 : 420;
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.exponentialRampToValueAtTime(endF, t0 + dur);

      // Amp envelope
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {}
  }

  toggleSidebar(forceOpen) {
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (!sidebar || !overlay) return;

    const shouldOpen =
      typeof forceOpen === "boolean"
        ? forceOpen
        : !sidebar.classList.contains("open");

    if (shouldOpen) {
      sidebar.classList.add("open");
      overlay.classList.add("active");
    } else {
      sidebar.classList.remove("open");
      overlay.classList.remove("active");
    }
  }
}

// Global function for closing preview
function closePreview() {
  window.pcuMedia.closePreview();
}

function closeUploadModal() {
  window.pcuMedia.closeUploadModal();
}

function closeFolderModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeFolderModal();
}

function closeMoveModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeMoveModal();
}

function closeRenameFileModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeRenameFileModal();
}

function closeDeleteFileModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeDeleteFileModal();
}

function closeRenameFolderModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeRenameFolderModal();
}

function closeDeleteFolderModal() {
  if (!window.pcuMedia) return;
  window.pcuMedia.closeDeleteFolderModal();
}

function toggleSidebar(forceOpen) {
  if (!window.pcuMedia) return;
  window.pcuMedia.toggleSidebar(forceOpen);
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.pcuMedia = new PCUMedia();
});

// Handle escape key for closing preview
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePreview();
    closeUploadModal();
    closeFolderModal();
    closeMoveModal();
    closeRenameFileModal();
    closeDeleteFileModal();
    closeRenameFolderModal();
    closeDeleteFolderModal();
    try {
      if (window.pcuMedia) window.pcuMedia.closeActionMenu();
    } catch {}
  }
});
