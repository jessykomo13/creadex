#pragma once

namespace WEngine {

    class Renderer {
    public:
        static void Init();
        static void OnWindowResize(unsigned int width, unsigned int height);

        static void SetClearColor(float r, float g, float b, float a);
        static void Clear();
    };

} // namespace WEngine
