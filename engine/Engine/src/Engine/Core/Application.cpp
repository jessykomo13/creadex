#include "Application.h"
#include "Log.h"
#include "Input.h"
#include "../Renderer/Renderer.h"

#include <GLFW/glfw3.h>

namespace WEngine {

    Application* Application::s_Instance = nullptr;

    Application::Application(const std::string& name) {
        s_Instance = this;

        m_Window = std::make_unique<Window>(WindowProps(name));
        m_Window->SetEventCallback([this](Event& e) { OnEvent(e); });

        Input::Init(m_Window.get());
        Renderer::Init();
    }

    Application::~Application() {
        s_Instance = nullptr;
    }

    void Application::PushLayer(Layer* layer) {
        m_LayerStack.PushLayer(layer);
    }

    void Application::PushOverlay(Layer* overlay) {
        m_LayerStack.PushOverlay(overlay);
    }

    void Application::Close() {
        m_Running = false;
    }

    void Application::OnEvent(Event& event) {
        if (event.GetEventType() == EventType::WindowClose) {
            OnWindowClose(static_cast<WindowCloseEvent&>(event));
        } else if (event.GetEventType() == EventType::WindowResize) {
            OnWindowResize(static_cast<WindowResizeEvent&>(event));
        }

        for (auto it = m_LayerStack.end(); it != m_LayerStack.begin();) {
            --it;
            if (event.Handled) break;
            (*it)->OnEvent(event);
        }
    }

    bool Application::OnWindowClose(WindowCloseEvent& event) {
        m_Running = false;
        return true;
    }

    bool Application::OnWindowResize(WindowResizeEvent& event) {
        if (event.GetWidth() == 0 || event.GetHeight() == 0) {
            m_Minimized = true;
            return false;
        }
        m_Minimized = false;
        Renderer::OnWindowResize(event.GetWidth(), event.GetHeight());
        return false;
    }

    void Application::Run() {
        WE_INFO("WEngine starting main loop.");

        while (m_Running) {
            float time = (float)glfwGetTime();
            Timestep timestep(time - m_LastFrameTime);
            m_LastFrameTime = time;

            if (!m_Minimized) {
                for (Layer* layer : m_LayerStack) {
                    layer->OnUpdate(timestep);
                }
            }

            m_Window->OnUpdate();
        }

        WE_INFO("WEngine shutting down.");
    }

} // namespace WEngine
