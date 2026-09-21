#pragma once

namespace WEngine {

    class Renderer {
    public:
        static void Init();
        static void OnWindowResize(unsigned int width, unsigned int height);

        static void SetClearColor(float r, float g, float b, float a);
        static void Clear();

        // Modes d'affichage du viewport (Eclaire / Non eclaire / Fil de fer)
        static void SetWireframe(bool enabled);
    };

} // namespace WEngine
