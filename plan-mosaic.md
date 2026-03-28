# Plan.md — Aplicación Web de Photographic Mosaic con procesamiento en frontend y backend PHP

## 1. Objetivo

Construir una aplicación web que:

1. Reciba una foto del usuario.
2. Genere un **photographic mosaic** en el navegador.
3. Use como base una colección de fotos de rostros almacenadas en el servidor.
4. Cargue desde backend únicamente imágenes ya preprocesadas y su metadata de color.
5. Mantenga el servidor liviano, usando PHP principalmente para servir archivos y metadata.

---

## 2. Decisión de arquitectura

### Enfoque elegido

**Frontend procesa el mosaico.**  
**Backend PHP sirve tiles e información preprocesada.**

### Motivo

En tu caso, esto es preferible porque:

- evita que PHP haga procesamiento pesado por cada usuario
- reduce problemas de `memory_limit` y `max_execution_time`
- permite una experiencia más interactiva
- aprovecha que las imágenes de la base ya estarán normalizadas
- encaja bien con un hosting PHP tradicional

---

## 3. Supuestos del proyecto

Se asume que:

- las fotos base son **caras profesionales**
- tienen **posición similar**
- tienen **iluminación similar**
- tienen **fondo uniforme**
- se mantendrá el fondo
- el mosaico final se arma con **tiles fotográficos reales**
- el matching se hará usando **mapas de color ya calculados**

Esto simplifica mucho el pipeline y mejora la consistencia visual.

---

## 4. Arquitectura general

```text
Usuario sube imagen
→ frontend carga imagen en canvas
→ frontend divide la imagen en celdas
→ frontend calcula color promedio por celda
→ frontend consulta metadata de tiles ya cargada
→ frontend busca el tile más cercano por color
→ frontend compone el mosaico en canvas
→ frontend permite exportar imagen final
```

### Roles por capa

#### Frontend

- recibe la foto del usuario
- analiza la imagen
- hace el matching
- compone el mosaico
- muestra preview y exportación

#### Backend PHP

- entrega `tiles.json`
- sirve thumbnails de tiles
- opcionalmente entrega lotes por categoría o tono
- aloja imágenes preprocesadas

---

## 5. Stack recomendado

### Frontend

- HTML
- CSS
- JavaScript
- Canvas 2D
- Web Worker opcional para optimización

### Backend

- PHP
- filesystem
- JSON estático o generado por PHP
- MariaDB opcional solo si luego quieres administración

### No obligatorio para MVP

- framework frontend
- Node.js
- procesamiento server-side
- colas de trabajo

---

## 6. Estructura de carpetas recomendada

```text
/project-root
  /public
    index.html
    /css
      styles.css
    /js
      app.js
      mosaic.js
      image-utils.js
      matcher.js
      renderer.js
      worker.js
  /backend
    tiles.php
    generate-tiles-json.php
  /data
    /tiles_raw
    /tiles_50
    /tiles_20
    tiles.json
  /uploads
  /output
  /docs
    Plan.md
```

### Descripción

- `tiles_raw`: originales
- `tiles_50`: versión base normalizada para análisis
- `tiles_20`: versión ligera para render
- `tiles.json`: metadata ya calculada
- `public/js`: lógica frontend
- `backend`: scripts PHP auxiliares

---

## 7. Preparación de imágenes base

## 7.1. Decisiones ya tomadas

Dado que:

- todas las fotos tienen fondo uniforme
- todas son profesionales
- tienen pose e iluminación similares

se trabajará con **Opción A**, es decir:

**mantener el fondo uniforme original**

No se hará remoción de fondo para el MVP.

---

## 7.2. Pipeline de preprocesamiento de imágenes

Cada imagen de la base debe pasar por:

1. recorte uniforme
2. resize a tamaño base
3. blur leve
4. cálculo de color promedio central
5. generación de thumbnail
6. registro en metadata JSON

---

## 7.3. Crop uniforme

Aunque las fotos ya sean consistentes, todas deben quedar con el mismo encuadre relativo.

### Regla recomendada

- rostro centrado
- margen similar arriba y abajo
- mismo encuadre horizontal
- mismo ratio final

### Recomendación práctica

Aplicar un crop fijo a toda la colección.

Ejemplo conceptual:

```text
tomar el 80% central de cada imagen
```

Ese porcentaje exacto debe ajustarse con una muestra visual.

---

## 7.4. Tamaños recomendados

### Versión base para análisis

- `50x50 px`

### Versión ligera para render

- `20x20 px`

### Motivo

- `50x50` permite un cálculo más estable del color promedio
- `20x20` reduce memoria y acelera render en navegador

---

## 7.5. Blur leve

Aplicar a la versión base:

- Gaussian blur entre `0.5` y `1.0`

### Motivo

Esto ayuda a:

- reducir ruido fino
- suavizar detalles faciales excesivos
- mejorar el blending general del mosaico

---

## 7.6. Muestreo de color

No usar todo el tile para calcular color promedio.

### Recomendación

Usar aproximadamente el **60% central** de la imagen.

### Motivo

Evita que influyan demasiado:

- bordes
- fondo extremo
- cabello lateral
- variaciones menos relevantes

---

## 8. Metadata de tiles

La metadata debe estar preprocesada y disponible para el frontend.

## 8.1. Formato recomendado de `tiles.json`

```json
[
  {
    "id": 1,
    "file": "persona_001.jpg",
    "thumb": "/data/tiles_20/persona_001.jpg",
    "full": "/data/tiles_50/persona_001.jpg",
    "avg_r": 132,
    "avg_g": 118,
    "avg_b": 109,
    "luma": 120,
    "bucket": "128-112-112"
  }
]
```

---

## 8.2. Campos recomendados

- `id`: identificador
- `file`: nombre de archivo
- `thumb`: ruta del thumbnail ligero
- `full`: ruta de versión base
- `avg_r`, `avg_g`, `avg_b`: promedio de color
- `luma`: luminancia
- `bucket`: agrupación cuantizada

---

## 8.3. Por qué incluir luminancia

Las caras responden muy fuerte a la luz.

Usar luminancia mejora notablemente el matching, porque una cara de brillo similar suele integrarse mejor aunque el RGB bruto no sea idéntico.

---

## 9. Backend PHP

## 9.1. Responsabilidades

El backend PHP debe:

- exponer la metadata
- servir los thumbnails
- opcionalmente regenerar `tiles.json`
- no generar mosaicos en tiempo real

---

## 9.2. Endpoint mínimo

### `tiles.php`

Este endpoint puede simplemente devolver el JSON:

```php
<?php
header('Content-Type: application/json; charset=utf-8');
readfile(__DIR__ . '/../data/tiles.json');
```

---

## 9.3. Script de preprocesamiento

Puede ser un script PHP ejecutado manualmente o por lote para:

- leer imágenes de `/tiles_raw`
- generar crops
- generar `50x50`
- generar `20x20`
- calcular metadata
- escribir `tiles.json`

---

## 9.4. Recomendación

Aunque se puede hacer en PHP, el preprocesamiento es un paso offline.  
No necesita formar parte de la app pública.

---

## 10. Frontend

## 10.1. Flujo de uso

1. usuario entra a la web
2. sube una imagen
3. la imagen se dibuja en canvas
4. el sistema la divide en una grilla
5. el frontend calcula el color promedio de cada celda
6. compara cada celda contra `tiles.json`
7. construye el mosaico en un canvas final
8. muestra resultado
9. permite descargar PNG o JPG

---

## 10.2. Componentes frontend recomendados

### `app.js`

- coordina flujo general
- carga metadata
- conecta UI

### `image-utils.js`

- resize de imagen
- lectura de pixels
- promedio de color

### `matcher.js`

- comparación entre celdas y tiles
- distancia de color
- cache
- buckets

### `renderer.js`

- dibuja tiles en canvas final

### `worker.js` opcional

- hace matching fuera del hilo principal

---

## 11. Estrategia de composición del mosaico

## 11.1. Canvas de análisis

Se dibuja la foto subida a un canvas intermedio con tamaño controlado.

### Ejemplo

- imagen objetivo: `1000x1000`
- grid: `50x50`
- tile visual: `20x20`

---

## 11.2. División en celdas

La imagen objetivo se divide en una grilla uniforme.

Cada celda representa una región de la imagen original a reemplazar por un rostro de la base.

---

## 11.3. Cálculo de color por celda

Para cada celda:

- leer píxeles
- calcular promedio RGB
- calcular luminancia
- cuantizar color
- buscar tile ideal

---

## 11.4. Render final

Para cada celda:

- cargar thumbnail seleccionado
- dibujarlo en la posición correspondiente
- repetir hasta completar el mosaico

---

## 12. Algoritmo de matching

## 12.1. Base del algoritmo

El matching se hará por cercanía de color.

### Distancia base

```text
dist = (r1-r2)^2 + (g1-g2)^2 + (b1-b2)^2
```

---

## 12.2. Mejora con luminancia

Se recomienda combinar RGB con luminancia:

```text
dist_total = dist_rgb + peso_luma * (luma1 - luma2)^2
```

Esto mejora la integración visual.

---

## 12.3. Cuantización

Para acelerar el matching, cuantizar colores.

### Ejemplo

```text
r = round(r / 16) * 16
g = round(g / 16) * 16
b = round(b / 16) * 16
```

Luego construir claves tipo:

```text
128-112-96
```

---

## 12.4. Buckets

Agrupar tiles por bucket permite comparar solo con subconjuntos relevantes.

### Ventaja

Reduce el costo de comparar una celda contra toda la base.

---

## 12.5. Cache de matching

Muchas celdas terminan teniendo colores parecidos.

Se debe usar cache:

```text
si el bucket ya fue resuelto antes
→ reutilizar resultado
```

Esto mejora mucho el rendimiento.

---

## 12.6. Penalización de repetición

Para evitar que una misma cara aparezca demasiadas veces seguidas:

- penalizar repetición inmediata
- o mantener una ventana de exclusión local

### Ejemplo

No permitir el mismo tile en celdas adyacentes o demasiado cercanas.

---

## 13. Carga de imágenes

## 13.1. Estrategia correcta

No cargar toda la colección completa en tamaño grande.

### Sí hacer

- cargar `tiles.json`
- cargar solo thumbnails `20x20`
- cachear en memoria solo los que se vayan usando

---

## 13.2. Opciones de carga

### Opción MVP

Precargar todos los thumbnails si el volumen es razonable.

### Opción escalable

Cargar thumbnails bajo demanda.

---

## 13.3. Recomendación para tu caso

Si el dataset no es gigantesco, puedes precargar thumbnails ligeros.

### Referencia

- hasta unos cientos o pocos miles de `20x20` puede ser manejable
- si el dataset crece mucho, pasar a carga progresiva

---

## 14. UX del MVP

## 14.1. Pantalla mínima

Debe tener:

- botón de upload
- preview de imagen original
- selector de tamaño de mosaico
- botón de generar
- preview del resultado
- botón de descarga

---

## 14.2. Parámetros configurables

### Recomendados

- resolución final
- tamaño de tile
- nivel de detalle
- permitir o no repetición
- peso de luminancia

---

## 14.3. Feedback visual

Durante el proceso mostrar:

- estado de carga de metadata
- progreso de matching
- progreso de render

---

## 15. Parámetros iniciales recomendados

### MVP base

- imagen final: `1000x1000`
- grid: `50x50`
- tile size: `20`
- thumbnails: `20x20`
- base de análisis: `50x50`
- blur: `0.5 - 1.0`
- cuantización RGB: múltiplos de `16`

---

## 16. Rendimiento esperado

## 16.1. Sin optimización fuerte

Si comparas todas las celdas con todos los tiles, el costo crece rápido.

---

## 16.2. Con optimización razonable

Usando:

- buckets
- cuantización
- cache
- thumbnails precargados

el rendimiento puede ser bueno para un MVP.

---

## 16.3. Estimación práctica

Con una grilla de `50x50` y un dataset moderado:

- tiempo aceptable en escritorio moderno
- experiencia razonablemente fluida
- mejor aún si se usa Web Worker

---

## 17. Web Worker

## 17.1. Cuándo usarlo

Si notas que la interfaz se congela durante el matching.

---

## 17.2. Qué mover al worker

Mover al worker:

- cálculo de color por celda
- búsqueda del mejor tile
- resolución de buckets

Mantener en hilo principal:

- UI
- preview
- render final en canvas

---

## 17.3. Recomendación

Para MVP puedes arrancar sin worker.  
Pero es una mejora casi segura para la siguiente iteración.

---

## 18. Fases del proyecto

## Fase 1. Preparación del dataset

### Objetivo

Dejar lista la base de rostros.

### Tareas

- revisar muestra visual
- definir crop fijo
- generar tiles base `50x50`
- generar thumbs `20x20`
- aplicar blur leve
- calcular metadata
- generar `tiles.json`

### Entregable

Dataset listo para consumo frontend.

---

## Fase 2. Backend PHP mínimo

### Objetivo

Servir metadata y archivos.

### Tareas

- crear `tiles.php`
- exponer rutas públicas
- validar estructura de carpetas
- probar carga de JSON
- probar acceso a thumbs

### Entregable

Backend funcional y liviano.

---

## Fase 3. Frontend MVP

### Objetivo

Generar mosaico en navegador.

### Tareas

- UI básica
- upload
- canvas de análisis
- cálculo de celdas
- matching por color
- render en canvas final
- descarga de resultado

### Entregable

Aplicación funcional de extremo a extremo.

---

## Fase 4. Optimización

### Objetivo

Mejorar tiempo de respuesta y calidad.

### Tareas

- buckets
- cache
- luminancia
- control de repetición
- progreso visual
- Web Worker

### Entregable

Versión más sólida y usable.

---

## 19. Estimación de tiempo

## Fase 1. Dataset

- 3 a 6 horas

## Fase 2. Backend PHP

- 1 a 3 horas

## Fase 3. Frontend MVP

- 8 a 14 horas

## Fase 4. Optimización

- 5 a 10 horas

### Total estimado

- MVP básico: **12 a 20 horas**
- versión más pulida: **18 a 33 horas**

---

## 20. Riesgos técnicos

### 1. Demasiadas imágenes precargadas

Puede afectar memoria del navegador.

### Mitigación

- usar thumbs pequeños
- lazy loading si hace falta

---

### 2. Matching lento

Puede congelar la interfaz.

### Mitigación

- buckets
- cache
- Web Worker

---

### 3. Repetición visual excesiva

El mosaico puede verse artificial.

### Mitigación

- penalización de repetición
- rotación entre mejores candidatos

---

### 4. Dataset desbalanceado en tonos

Puede hacer que algunas zonas del mosaico no encuentren buen reemplazo.

### Mitigación

- revisar distribución de luminancia
- ampliar colección en tonos faltantes

---

## 21. Calidad visual

## 21.1. Qué hace que el resultado se vea bien

- tiles homogéneos
- fondo consistente
- distribución tonal amplia
- blur leve
- buena grilla
- matching con luminancia

---

## 21.2. Qué no conviene hacer

- usar tiles grandes sin optimizar
- mezclar fotos con encuadres muy distintos
- hacer matching solo por nombre o categorías
- depender del backend para composición en tiempo real

---

## 22. Recomendación final de implementación

La mejor decisión para este proyecto es:

### Backend PHP

- servir tiles preprocesados
- servir metadata JSON
- no renderizar mosaico en servidor

### Frontend JS

- analizar imagen del usuario
- resolver matching por color
- renderizar el mosaico en canvas
- exportar resultado final

---

## 23. MVP exacto recomendado

### Debe incluir

- upload de imagen
- carga de `tiles.json`
- matching RGB + luminancia
- render en canvas
- descarga de imagen final

### Puede esperar

- worker
- panel avanzado de parámetros
- administración visual del dataset
- persistencia de proyectos
- procesamiento multiusuario complejo

---

## 24. Siguiente paso sugerido

Después de este plan, el siguiente entregable lógico es uno de estos:

1. estructura completa de archivos del proyecto
2. script de preprocesamiento del dataset
3. MVP de frontend con canvas y matching
4. versión con Web Worker desde el inicio

