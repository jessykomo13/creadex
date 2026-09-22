#!/usr/bin/env bash
# Compile WEngine pour le navigateur (WebAssembly) avec Emscripten.
# Produit un seul fichier web/WEngine.html a ouvrir directement (double-clic
# ou "Ouvrir avec le navigateur" sur telephone) : tout est embarque dedans
# (JS, WASM, fichiers de la scene) en base64, pas de serveur necessaire.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMGUI_SRC="$ROOT/build/_deps/imgui-src"
OUT_DIR="$ROOT/web"
mkdir -p "$OUT_DIR"

if [ ! -d "$IMGUI_SRC" ]; then
    echo "imgui introuvable dans $IMGUI_SRC (lance d'abord le build desktop une fois)." >&2
    exit 1
fi

SOURCES=(
    "$ROOT/Engine/src/Engine/Core/Log.cpp"
    "$ROOT/Engine/src/Engine/Core/Window.cpp"
    "$ROOT/Engine/src/Engine/Core/LayerStack.cpp"
    "$ROOT/Engine/src/Engine/Core/Application.cpp"
    "$ROOT/Engine/src/Engine/Core/Input.cpp"
    "$ROOT/Engine/src/Engine/Core/ImGuiLayer.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Renderer.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Shader.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Mesh.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Camera.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Texture.cpp"
    "$ROOT/Engine/src/Engine/Renderer/Framebuffer.cpp"
    "$ROOT/Sandbox/src/SandboxApp.cpp"
    "$IMGUI_SRC/imgui.cpp"
    "$IMGUI_SRC/imgui_draw.cpp"
    "$IMGUI_SRC/imgui_tables.cpp"
    "$IMGUI_SRC/imgui_widgets.cpp"
    "$IMGUI_SRC/backends/imgui_impl_glfw.cpp"
    "$IMGUI_SRC/backends/imgui_impl_opengl3.cpp"
)

INCLUDES=(
    -I"$ROOT/Engine/src"
    -I"$ROOT/Engine/vendor/glad_web/include"
    -I"$ROOT/Engine/vendor/stb"
    -I"$IMGUI_SRC"
    -I"$IMGUI_SRC/backends"
)

FLAGS=(
    -std=c++17 -O2
    -sUSE_GLFW=3
    -sFULL_ES3=1
    -sMIN_WEBGL_VERSION=2
    -sMAX_WEBGL_VERSION=2
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sASSERTIONS=0
    -sSINGLE_FILE=1
    --embed-file "$ROOT/assets@assets"
    --shell-file "$ROOT/web-shell.html"
    -DGLFW_INCLUDE_NONE
)

echo "Compilation WebAssembly (peut prendre une minute)..."
em++ "${SOURCES[@]}" "${INCLUDES[@]}" "${FLAGS[@]}" -o "$OUT_DIR/WEngine.html"

echo "OK -> $OUT_DIR/WEngine.html ($(du -h "$OUT_DIR/WEngine.html" | cut -f1))"
