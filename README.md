# Este candidato no existe

https://candidatos.incaslop.online/

Micrositio narrativo hecho con React + Vite sobre el "rostro promedio" de las candidaturas al Congreso peruano 2026. El recorrido termina con un generador de mosaicos que recompone tu foto usando retratos reales del dataset electoral.

Las imagenes son obtenidas, y procesadas de: https://github.com/jruizcabrejos/candidato2026

## Que muestra

- una apertura con la bandera del Peru y rostros promedio rotando por region y sexo,
- un rostro promedio nacional con accesos a drawers comparativos por regiones y partidos,
- un generador de mosaicos que corre completamente en el navegador, con exportacion de imagen y tarjeta en formato retrato.

## Desarrollo rapido

```bash
npm ci
npm run dev
```

El repo publico ya incluye los assets generados en `public/generated/` y los manifiestos en `src/generated/`, asi que no necesitas `output/` para levantar la app o compilarla.

## Scripts principales

```bash
npm run dev
```

Levanta Vite usando los assets ya versionados.

```bash
npm run build
```

Compila `dist/` sin regenerar assets.

```bash
npm run generate
```

Regenera los assets web desde los insumos internos. Este paso requiere el dataset local en `output/`.

```bash
npm run dev:full
npm run build:full
```

Versiones internas que regeneran assets antes de arrancar o compilar.

## Estructura publica

- `src/`: frontend en React.
- `public/generated/`: imagenes, atlas y assets web ya preparados.
- `src/generated/`: manifiestos consumidos por la app.
- `.github/workflows/deploy.yml`: build y deploy.
- `INTERNAL_README.md`: documentacion tecnica e interna del pipeline.

## Nota

La documentacion operativa completa, el pipeline de generacion y los detalles del dataset viven en `INTERNAL_README.md`. Las carpetas pesadas de trabajo interno como `output/`, `tmp/` y `run/` no forman parte del shape publico del repositorio.
