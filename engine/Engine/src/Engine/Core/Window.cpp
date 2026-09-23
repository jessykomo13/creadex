#include "Window.h"
#include "Log.h"

#include <glad/glad.h>
#include <GLFW/glfw3.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/html5.h>
#endif

namespace WEngine {

    static bool s_GLFWInitialized = false;

    static void GLFWErrorCallback(int error, const char* description) {
        WE_ERROR("GLFW Error (", error, "): ", description);
    }

    Window::Window(const WindowProps& props) {
        Init(props);
    }

    Window::~Window() {
        Shutdown();
    }

    void Window::Init(const WindowProps& props) {
        unsigned int width = props.Width, height = props.Height;
#ifdef __EMSCRIPTEN__
        // Dans le navigateur, la taille voulue c'est celle de l'ecran du
        // telephone/de l'onglet, pas la taille par defaut de la fenetre
        // desktop : sinon l'image est etiree pour remplir l'ecran.
        double cssW, cssH;
        emscripten_get_element_css_size("#canvas", &cssW, &cssH);
        if (cssW > 0 && cssH > 0) { width = (unsigned int)cssW; height = (unsigned int)cssH; }
#endif
        m_Data.Title = props.Title;
        m_Data.Width = width;
        m_Data.Height = height;

        WE_INFO("Creating window \"", props.Title, "\" (", width, "x", height, ")");

        if (!s_GLFWInitialized) {
            int success = glfwInit();
            if (!success) {
                WE_ERROR("Could not initialize GLFW!");
                return;
            }
            glfwSetErrorCallback(GLFWErrorCallback);
            s_GLFWInitialized = true;
        }

        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
        glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
        glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
#endif

        m_Window = glfwCreateWindow((int)width, (int)height, m_Data.Title.c_str(), nullptr, nullptr);
        if (!m_Window) {
            WE_ERROR("Could not create GLFW window!");
            return;
        }

        glfwMakeContextCurrent(m_Window);
        glfwSetWindowUserPointer(m_Window, &m_Data);

#ifndef __EMSCRIPTEN__
        int status = gladLoadGLLoader((GLADloadproc)glfwGetProcAddress);
        if (!status) {
            WE_ERROR("Failed to initialize Glad!");
            return;
        }
#endif

        WE_INFO("OpenGL Info: ", (const char*)glGetString(GL_RENDERER), " / ", (const char*)glGetString(GL_VERSION));

        SetVSync(true);

        glfwSetWindowSizeCallback(m_Window, [](GLFWwindow* window, int width, int height) {
            WindowData& data = *(WindowData*)glfwGetWindowUserPointer(window);
            data.Width = width;
            data.Height = height;

            WindowResizeEvent event(width, height);
            if (data.EventCallback) data.EventCallback(event);
        });

        glfwSetWindowCloseCallback(m_Window, [](GLFWwindow* window) {
            WindowData& data = *(WindowData*)glfwGetWindowUserPointer(window);
            WindowCloseEvent event;
            if (data.EventCallback) data.EventCallback(event);
        });

        glfwSetKeyCallback(m_Window, [](GLFWwindow* window, int key, int scancode, int action, int mods) {
            WindowData& data = *(WindowData*)glfwGetWindowUserPointer(window);
            switch (action) {
                case GLFW_PRESS: {
                    KeyPressedEvent event(key, false);
                    if (data.EventCallback) data.EventCallback(event);
                    break;
                }
                case GLFW_RELEASE: {
                    KeyReleasedEvent event(key);
                    if (data.EventCallback) data.EventCallback(event);
                    break;
                }
                case GLFW_REPEAT: {
                    KeyPressedEvent event(key, true);
                    if (data.EventCallback) data.EventCallback(event);
                    break;
                }
            }
        });

#ifdef __EMSCRIPTEN__
        // Suit la taille reelle de l'onglet/ecran (rotation de telephone,
        // redimensionnement de fenetre) au lieu de rester a la taille du
        // lancement, ce qui etirerait sinon l'image.
        auto onBrowserResize = [](int, const EmscriptenUiEvent*, void* userData) -> EM_BOOL {
            WindowData& data = *(WindowData*)userData;
            double cssW, cssH;
            emscripten_get_element_css_size("#canvas", &cssW, &cssH);
            if (cssW > 0 && cssH > 0) {
                emscripten_set_canvas_element_size("#canvas", (int)cssW, (int)cssH);
                data.Width = (unsigned int)cssW;
                data.Height = (unsigned int)cssH;
                WindowResizeEvent event(data.Width, data.Height);
                if (data.EventCallback) data.EventCallback(event);
            }
            return EM_TRUE;
        };
        emscripten_set_resize_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, &m_Data, false, onBrowserResize);
#endif
    }

    void Window::Shutdown() {
        if (m_Window) {
            glfwDestroyWindow(m_Window);
            m_Window = nullptr;
        }
    }

    void Window::OnUpdate() {
        glfwPollEvents();
        glfwSwapBuffers(m_Window);
    }

    void Window::SetVSync(bool enabled) {
        glfwSwapInterval(enabled ? 1 : 0);
        m_Data.VSync = enabled;
    }

} // namespace WEngine
