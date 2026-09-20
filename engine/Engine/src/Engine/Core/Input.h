#pragma once

#include <utility>

namespace WEngine {

    class Window;

    class Input {
    public:
        static void Init(Window* window) { s_Window = window; }

        static bool IsKeyPressed(int keyCode);
        static bool IsMouseButtonPressed(int button);
        static std::pair<float, float> GetMousePosition();

    private:
        static Window* s_Window;
    };

} // namespace WEngine
