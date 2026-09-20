#include <Engine.h>
#include <vector>
#include <memory>

static const char* VERTEX_SRC = R"(
#version 330 core
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

uniform mat4 u_ViewProj;
uniform mat4 u_Model;

out vec3 v_Color;

void main() {
    v_Color = a_Color;
    gl_Position = u_ViewProj * u_Model * vec4(a_Position, 1.0);
}
)";

static const char* FRAGMENT_SRC = R"(
#version 330 core
in vec3 v_Color;
out vec4 FragColor;

void main() {
    FragColor = vec4(v_Color, 1.0);
}
)";

// Scene 3D de demonstration : sol quadrille + quelques cubes, avec une
// camera libre style "viewport Unreal" (clic droit + souris pour regarder,
// WASD/QE pour se deplacer).
class Scene3DLayer : public WEngine::Layer {
public:
    Scene3DLayer() : Layer("Scene3D") {
        m_Shader = std::make_unique<WEngine::Shader>(VERTEX_SRC, FRAGMENT_SRC);
        m_Cube.reset(WEngine::Mesh::CreateCube());
        m_Grid.reset(WEngine::Mesh::CreateGrid(10, 1.0f));

        m_CubePositions = {
            { 0.0f, 0.5f,  0.0f},
            { 2.5f, 0.5f, -1.5f},
            {-2.0f, 1.0f,  1.0f},
            { 1.0f, 1.5f,  3.0f},
            {-3.0f, 0.5f, -2.5f},
        };
    }

    void OnUpdate(WEngine::Timestep ts) override {
        m_Camera.OnUpdate(ts);
        m_Time += ts.GetSeconds();

        WEngine::Renderer::SetClearColor(0.06f, 0.07f, 0.10f, 1.0f);
        WEngine::Renderer::Clear();

        auto& window = WEngine::Application::Get().GetWindow();
        float aspect = (float)window.GetWidth() / (float)window.GetHeight();
        WEngine::Mat4 proj = WEngine::Mat4::Perspective(45.0f * 3.14159265f / 180.0f, aspect, 0.1f, 100.0f);
        WEngine::Mat4 viewProj = WEngine::Mat4::Multiply(proj, m_Camera.GetViewMatrix());

        m_Shader->Bind();
        m_Shader->SetMat4("u_ViewProj", viewProj.m);

        WEngine::Mat4 gridModel = WEngine::Mat4::Identity();
        m_Shader->SetMat4("u_Model", gridModel.m);
        m_Grid->Draw();

        int i = 0;
        for (auto& pos : m_CubePositions) {
            WEngine::Mat4 model = WEngine::Mat4::Multiply(
                WEngine::Mat4::Translate(pos),
                WEngine::Mat4::RotateY(m_Time * (0.4f + 0.15f * i))
            );
            m_Shader->SetMat4("u_Model", model.m);
            m_Cube->Draw();
            i++;
        }
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() == WEngine::EventType::KeyPressed) {
            auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
            constexpr int KEY_ESCAPE = 256;
            if (e.GetKeyCode() == KEY_ESCAPE) {
                WEngine::Application::Get().Close();
            }
        }
    }

private:
    std::unique_ptr<WEngine::Shader> m_Shader;
    std::unique_ptr<WEngine::Mesh> m_Cube;
    std::unique_ptr<WEngine::Mesh> m_Grid;
    std::vector<WEngine::Vec3> m_CubePositions;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
};

class SandboxApp : public WEngine::Application {
public:
    SandboxApp() : Application("WEngine Sandbox - Scene 3D") {
        PushLayer(new Scene3DLayer());
    }
};

WEngine::Application* WEngine::CreateApplication() {
    return new SandboxApp();
}
