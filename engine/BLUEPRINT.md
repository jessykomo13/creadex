# WEngine — Blueprint

Moteur de jeu C++ minimal mais fonctionnel, inspiré de l'architecture visible
dans la capture d'écran fournie (un module `Engine` compilé en bibliothèque
statique, chargé par GLAD pour OpenGL, et un projet `Sandbox` qui l'utilise
pour lancer une fenêtre).

## Arborescence

```
engine/
├── CMakeLists.txt          racine : télécharge GLFW, assemble Engine + Sandbox
├── Engine/                 bibliothèque statique "Engine"
│   ├── vendor/glad/        chargeur OpenGL (glad.h / glad.c généré)
│   └── src/
│       ├── Engine.h            <- point d'entrée public + main()
│       └── Engine/
│           ├── Core/
│           │   ├── Log.h/.cpp          logs WE_INFO/WE_WARN/WE_ERROR
│           │   ├── Window.h/.cpp       fenêtre GLFW + contexte GL
│           │   ├── Event.h             événements (fenêtre, clavier, souris)
│           │   ├── Input.h/.cpp        état clavier/souris à la demande
│           │   ├── Layer.h             couche de jeu (OnUpdate/OnEvent)
│           │   ├── LayerStack.h/.cpp   pile de couches (jeu + overlays UI)
│           │   ├── Timestep.h          delta time entre deux frames
│           │   └── Application.h/.cpp  boucle principale, orchestre tout
│           └── Renderer/
│               ├── Renderer.h/.cpp     clear color, viewport, init GL
│               └── Shader.h/.cpp       compilation/link de shaders GLSL
└── Sandbox/                 exécutable "Sandbox" (jeu d'exemple)
    └── src/SandboxApp.cpp   implémente WEngine::CreateApplication()
```

## Flux d'exécution

1. `Engine.h` définit `main()` : il appelle `WEngine::CreateApplication()`
   (fonction que le jeu client doit implémenter), puis `app->Run()`.
2. `Application::Application()` crée la `Window` (GLFW), initialise GLAD
   (chargement des fonctions OpenGL) et le `Renderer`.
3. `Application::Run()` boucle : calcule le `Timestep`, met à jour les
   `Layer`s empilées dans la `LayerStack`, puis `Window::OnUpdate()`
   (poll des événements + swap des buffers).
4. Les événements GLFW (resize, fermeture, clavier) sont convertis en
   objets `Event` et redescendent dans la pile de couches via
   `Application::OnEvent`.
5. Une couche de jeu (ex. `SandboxLayer`) définit `OnUpdate` (dessiner)
   et `OnEvent` (réagir aux entrées) sans jamais toucher à GLFW/GLAD
   directement — tout passe par l'API `WEngine::*`.

## Dépendances

- **GLFW 3.4** — création de fenêtre / contexte OpenGL, récupérée via
  `FetchContent` (pas besoin de l'installer manuellement).
- **GLAD** (OpenGL 4.6 core, généré) — vendored dans
  `Engine/vendor/glad/`, comme `glad.lib` sur la capture d'écran.
- **OpenGL** — fourni par le système (`libGL`/pilote GPU).

## Rendu 3D et caméra libre

- `Core/Math.h` — Vec3/Mat4 minimalistes (perspective, lookAt, translate,
  rotate) sans dépendance externe (pas de GLM).
- `Renderer/Mesh.h/.cpp` — VAO/VBO/EBO, avec des primitives prêtes à
  l'emploi : `Mesh::CreateCube()`, `Mesh::CreateGrid()`.
- `Renderer/Camera.h/.cpp` — caméra libre façon **viewport Unreal** :
  maintenir le **clic droit** + bouger la souris pour regarder autour,
  **WASD** pour avancer/reculer/strafer, **Q/E** pour monter/descendre,
  **Shift** pour accélérer.
- `Sandbox/src/SandboxApp.cpp` — scène de démonstration : sol quadrillé +
  cubes colorés qui tournent, rendus via un shader GLSL minimal (MVP).

## Build (Linux, testé dans cet environnement)

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build -j
./engine/build/Sandbox/Sandbox
```

La fenêtre s'ouvre, le contexte OpenGL s'initialise, la scène 3D (sol +
cubes) s'affiche et la caméra libre répond au clavier/souris — vérifié par
capture d'écran dans ce même environnement (rendu logiciel llvmpipe, un
vrai GPU sera plus rapide mais le résultat est identique).

## Build Windows + installeur (.exe)

Le projet compile aussi en croisé depuis Linux avec **mingw-w64**, et
génère un **installeur Windows (NSIS)** via CPack — testé et confirmé
fonctionnel dans cet environnement :

```bash
cmake -S engine -B engine/build-win -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_TOOLCHAIN_FILE=engine/cmake/mingw-w64-toolchain.cmake
cmake --build engine/build-win -j
cd engine/build-win && cpack -G NSIS
# -> WEngineSandbox-0.1.0-win64.exe (installeur autonome, lien statique)
```

Sous Windows natif avec Visual Studio (comme sur ta capture d'écran
d'origine), on peut aussi générer directement une solution `.sln` :

```bash
cmake -S engine -B engine/build -G "Visual Studio 17 2022"
```
et ajouter le même bloc CPack/NSIS pour produire l'installeur depuis
Visual Studio.

**Limite connue** : l'installeur `.exe` a été généré et vérifié comme un
binaire Windows PE32+ valide (compilation + link statiques réussis sans
erreur), mais n'a pas pu être testé en exécution ici faute d'un
environnement Windows réel (Wine, utilisé pour essayer, est cassé dans ce
sandbox à cause d'une dépendance i386 manquante). À tester sur une vraie
machine Windows pour confirmer le lancement.

## Prochaines étapes possibles

- Système d'entités (ECS) pour les objets de jeu.
- Chargement d'assets (textures, modèles, sons).
- Couche d'UI immédiate (ex. Dear ImGui) pour un éditeur avec panneaux,
  comme un vrai viewport d'édition.
- Sélection/déplacement d'objets à la souris dans la scène 3D.
