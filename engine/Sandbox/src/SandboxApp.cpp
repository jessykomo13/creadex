#include <Engine.h>
#include <vector>
#include <memory>
#include <string>

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

uniform vec3 u_Tint;

void main() {
    FragColor = vec4(v_Color * u_Tint, 1.0);
}
)";

struct SceneObject {
    std::string name;
    WEngine::Vec3 position;
    WEngine::Vec3 tint{ 1.0f, 1.0f, 1.0f };
    float rotationSpeed = 0.0f;
};

// Scene 3D + editeur : viewport libre (camera Unreal-like) avec, par-dessus,
// des panneaux ImGui dockables (Outliner, Inspecteur, Stats) qu'on peut
// deplacer et arrimer n'importe ou dans la fenetre.
class Scene3DLayer : public WEngine::Layer {
public:
    Scene3DLayer() : Layer("Scene3D") {
        m_Shader = std::make_unique<WEngine::Shader>(VERTEX_SRC, FRAGMENT_SRC);
        m_Cube.reset(WEngine::Mesh::CreateCube());
        m_Grid.reset(WEngine::Mesh::CreateGrid(10, 1.0f));

        m_Objects.push_back({ "Cube 1", {0.0f, 0.5f, 0.0f}, {0.85f,0.35f,0.35f}, 0.4f });
        m_Objects.push_back({ "Cube 2", {2.5f, 0.5f, -1.5f}, {0.35f,0.65f,0.9f}, 0.55f });
        m_Objects.push_back({ "Cube 3", {-2.0f, 1.0f, 1.0f}, {0.4f,0.85f,0.55f}, 0.7f });
        m_Objects.push_back({ "Cube 4", {1.0f, 1.5f, 3.0f}, {0.95f,0.75f,0.25f}, 0.85f });
        m_Objects.push_back({ "Cube 5", {-3.0f, 0.5f, -2.5f}, {0.7f,0.5f,0.9f}, 1.0f });
    }

    void OnUpdate(WEngine::Timestep ts) override {
        if (!ImGui::GetIO().WantCaptureMouse) {
            m_Camera.OnUpdate(ts);
        }
        m_Time += ts.GetSeconds();
        m_LastFrameTime = ts.GetSeconds();

        WEngine::Renderer::SetClearColor(0.06f, 0.07f, 0.10f, 1.0f);
        WEngine::Renderer::Clear();

        auto& window = WEngine::Application::Get().GetWindow();
        float aspect = (float)window.GetWidth() / (float)window.GetHeight();
        WEngine::Mat4 proj = WEngine::Mat4::Perspective(45.0f * 3.14159265f / 180.0f, aspect, 0.1f, 100.0f);
        WEngine::Mat4 viewProj = WEngine::Mat4::Multiply(proj, m_Camera.GetViewMatrix());

        m_Shader->Bind();
        m_Shader->SetMat4("u_ViewProj", viewProj.m);

        m_Shader->SetFloat3("u_Tint", 1.0f, 1.0f, 1.0f);
        m_Shader->SetMat4("u_Model", WEngine::Mat4::Identity().m);
        m_Grid->Draw();

        for (auto& obj : m_Objects) {
            WEngine::Mat4 model = WEngine::Mat4::Multiply(
                WEngine::Mat4::Translate(obj.position),
                WEngine::Mat4::RotateY(m_Time * obj.rotationSpeed)
            );
            m_Shader->SetFloat3("u_Tint", obj.tint.x, obj.tint.y, obj.tint.z);
            m_Shader->SetMat4("u_Model", model.m);
            m_Cube->Draw();
        }
    }

    void OnImGuiRender() override {
        ImGui::Begin("Outliner");
        ImGui::TextDisabled("%d objets", (int)m_Objects.size());
        ImGui::Separator();
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            bool selected = (m_Selected == i);
            if (ImGui::Selectable(m_Objects[i].name.c_str(), selected)) {
                m_Selected = i;
            }
        }
        ImGui::Separator();
        if (ImGui::Button("+ Ajouter un cube", ImVec2(-1, 0))) {
            WEngine::Vec3 spawnPos = m_Camera.Position + m_Camera.Forward() * 4.0f;
            m_Objects.push_back({ "Cube " + std::to_string(++m_NextId), spawnPos, {0.8f,0.8f,0.8f}, 0.5f });
            m_Selected = (int)m_Objects.size() - 1;
        }
        ImGui::End();

        ImGui::Begin("Inspecteur");
        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            SceneObject& obj = m_Objects[m_Selected];
            ImGui::Text("%s", obj.name.c_str());
            ImGui::Separator();
            ImGui::DragFloat3("Position", &obj.position.x, 0.05f);
            ImGui::ColorEdit3("Couleur", &obj.tint.x);
            ImGui::DragFloat("Vitesse rotation", &obj.rotationSpeed, 0.02f, 0.0f, 5.0f);
            ImGui::Separator();
            if (ImGui::Button("Supprimer", ImVec2(-1, 0))) {
                m_Objects.erase(m_Objects.begin() + m_Selected);
                m_Selected = -1;
            }
        } else {
            ImGui::TextDisabled("Selectionne un objet dans l'Outliner.");
        }
        ImGui::End();

        ImGui::Begin("Stats");
        ImGui::Text("FPS: %.0f", m_LastFrameTime > 0.0f ? 1.0f / m_LastFrameTime : 0.0f);
        ImGui::Text("Camera pos: %.1f, %.1f, %.1f", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        ImGui::Separator();
        ImGui::TextWrapped("Clic droit + souris : regarder autour");
        ImGui::TextWrapped("WASD : se deplacer, Q/E : monter/descendre, Shift : plus vite");
        ImGui::TextWrapped("Ces panneaux se deplacent et s'arriment ou tu veux (tire un titre).");
        ImGui::End();
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
    std::vector<SceneObject> m_Objects;
    int m_Selected = -1;
    int m_NextId = 5;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;
};

class SandboxApp : public WEngine::Application {
public:
    SandboxApp() : Application("WEngine Editor") {
        PushLayer(new Scene3DLayer());
    }
};

WEngine::Application* WEngine::CreateApplication() {
    return new SandboxApp();
}
