# PCU Media - PlayCenter Universal

Panel visual para gestionar imágenes y videos de PlayCenter Universal

## Características

- 📁 Gestión de carpetas y archivos multimedia
- 📤 Subida de imágenes y videos
- 🎨 Interfaz moderna y responsiva
- 🔍 Búsqueda y filtrado de contenido
- 📱 Compatible con móviles y desktop

## Tecnologías

- **Backend**: Node.js + Express
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla
- **Storage**: Sistema de archivos local
- **Upload**: Multer para manejo de archivos

## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/Arisleidy07/PCU-Media.git
cd PCU-Media
```

2. Instalar dependencias:
```bash
npm install
```

3. Iniciar el servidor:
```bash
npm start
```

O para desarrollo:
```bash
npm run dev
```

## Uso

La aplicación estará disponible en `http://localhost:3000`

## Estructura del Proyecto

```
PCU-Media/
├── server.js          # Servidor backend
├── index.html         # Página principal
├── app.js            # Lógica del frontend
├── firebase.js       # Configuración de Firebase
├── styles.css        # Estilos principales
├── theme-executive.css # Tema visual
├── media/            # Carpeta de archivos multimedia
└── package.json      # Configuración del proyecto
```

## API Endpoints

- `GET /api/files` - Obtener archivos de una carpeta
- `POST /api/upload` - Subir archivos
- `POST /api/folders` - Crear carpeta
- `DELETE /api/file` - Eliminar archivo
- `DELETE /api/folder` - Eliminar carpeta
- `POST /api/file/rename` - Renombrar archivo
- `POST /api/file/move` - Mover archivo

## Licencia

MIT License - PlayCenter Universal
