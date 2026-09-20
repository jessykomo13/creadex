#include "Input.h"
#include "Window.h"

#include <GLFW/glfw3.h>

namespace WEngine {

    Window* Input::s_Window = nullptr;

    bool Input::IsKeyPressed(int keyCode) {
        if (!s_Window) return false;
        auto* window = static_cast<GLFWwindow*>(s_Window->GetNativeWindow());
        int state = glfwGetKey(window, keyCode);
        return state == GLFW_PRESS || state == GLFW_REPEAT;
    }

    bool Input::IsMouseButtonPressed(int button) {
        if (!s_Window) return false;
        auto* window = static_cast<GLFWwindow*>(s_Window->GetNativeWindow());
        int state = glfwGetMouseButton(window, button);
        return state == GLFW_PRESS;
    }

    std::pair<float, float> Input::GetMousePosition() {
        if (!s_Window) return { 0.0f, 0.0f };
        auto* window = static_cast<GLFWwindow*>(s_Window->GetNativeWindow());
        double x, y;
        glfwGetCursorPos(window, &x, &y);
        return { (float)x, (float)y };
    }

} // namespace WEngine
