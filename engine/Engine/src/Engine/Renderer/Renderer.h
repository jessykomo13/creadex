#pragma once

namespace WEngine {

    class Renderer {
    public:
        static void Init();
        static void OnWindowResize(unsigned int width, unsigned int height);
        static void SetViewport(int x, int y, int width, int height);

        static void SetClearColor(float r, float g, float b, float a);
        static void Clear();
        // Efface seulement la profondeur : ce qui est dessine ensuite passe
        // devant tout le reste (gizmo toujours visible, comme dans Unreal).
        static void ClearDepth();

        // Modes d'affichage du viewport (Eclaire / Non eclaire / Fil de fer)
        static void SetWireframe(bool enabled);
    };

} // namespace WEngine
