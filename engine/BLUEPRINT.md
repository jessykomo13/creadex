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

## Build

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build -j
./engine/build/Sandbox/Sandbox
```

Testé et validé dans cet environnement (Linux, X11) : la fenêtre s'ouvre,
le contexte OpenGL s'initialise, la boucle de rendu tourne.

Sous Windows/Visual Studio (comme dans la capture d'écran d'origine),
CMake peut générer une solution `.sln` directement :

```bash
cmake -S engine -B engine/build -G "Visual Studio 17 2022"
```

## Prochaines étapes possibles

- Renderer 2D (sprites/quads batché) ou 3D (mesh, caméra).
- Système d'entités (ECS) pour les objets de jeu.
- Chargement d'assets (textures, modèles, sons).
- Couche d'UI immédiate (ex. Dear ImGui) pour un éditeur.
