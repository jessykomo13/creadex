#pragma once

#include <memory>
#include <string>

#include "Window.h"
#include "LayerStack.h"
#include "Event.h"
#include "Timestep.h"

namespace WEngine {

    class Application {
    public:
        explicit Application(const std::string& name = "WEngine App");
        virtual ~Application();

        void Run();
        void Close();
        void OnEvent(Event& event);

        void PushLayer(Layer* layer);
        void PushOverlay(Layer* overlay);

        Window& GetWindow() { return *m_Window; }
        static Application& Get() { return *s_Instance; }

    private:
        bool OnWindowClose(WindowCloseEvent& event);
        bool OnWindowResize(WindowResizeEvent& event);

    private:
        std::unique_ptr<Window> m_Window;
        LayerStack m_LayerStack;
        bool m_Running = true;
        bool m_Minimized = false;
        float m_LastFrameTime = 0.0f;

        static Application* s_Instance;
    };

    // Defined by the client application (Sandbox).
    Application* CreateApplication();

} // namespace WEngine
