#include <Engine.h>

// Exemple de "jeu" : une couche qui efface l'ecran avec une couleur
// et reagit a la touche Echap pour fermer la fenetre.
class SandboxLayer : public WEngine::Layer {
public:
    SandboxLayer() : Layer("Sandbox") {}

    void OnUpdate(WEngine::Timestep ts) override {
        WEngine::Renderer::SetClearColor(0.10f, 0.10f, 0.14f, 1.0f);
        WEngine::Renderer::Clear();
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() == WEngine::EventType::KeyPressed) {
            auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
            constexpr int KEY_ESCAPE = 256; // GLFW_KEY_ESCAPE
            if (e.GetKeyCode() == KEY_ESCAPE) {
                WEngine::Application::Get().Close();
            }
        }
    }
};

class SandboxApp : public WEngine::Application {
public:
    SandboxApp() : Application("WEngine Sandbox") {
        PushLayer(new SandboxLayer());
    }
};

WEngine::Application* WEngine::CreateApplication() {
    return new SandboxApp();
}
