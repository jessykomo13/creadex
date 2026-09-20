#include <Engine.h>
#include <vector>
#include <memory>
#include <string>
#include <cstdio>

#include <GLFW/glfw3.h>

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

static const char* DEFAULT_SCRIPT_TEMPLATE =
"// Logique de \"%s\"\n"
"// Ceci n'est pas encore execute automatiquement : c'est ta zone pour\n"
"// preparer/noter le comportement de cet objet (collisions, pieges, vie...).\n"
"// La prochaine etape sera de rendre ce script reellement executable.\n"
"\n"
"on_collision(joueur):\n"
"    // exemple : piege qui enleve une vie et repousse le joueur\n"
"    joueur.vie -= 1\n"
"    joueur.velocite.y = 8.0\n"
"    if joueur.vie <= 0:\n"
"        redemarrer_niveau()\n";

struct SceneObject {
    std::string name;
    WEngine::Vec3 position;
    WEngine::Vec3 tint{ 1.0f, 1.0f, 1.0f };
    float rotationSpeed = 0.0f;
    float pickRadius = 0.9f;
    std::string script;
};

static int ScriptEditCallback(ImGuiInputTextCallbackData* data) {
    if (data->EventFlag == ImGuiInputTextFlags_CallbackResize) {
        std::string* str = (std::string*)data->UserData;
        str->resize(data->BufTextLen);
        data->Buf = (char*)str->c_str();
    }
    return 0;
}

static const WEngine::Vec3 AXIS_X(1.0f, 0.0f, 0.0f);
static const WEngine::Vec3 AXIS_Y(0.0f, 1.0f, 0.0f);
static const WEngine::Vec3 AXIS_Z(0.0f, 0.0f, 1.0f);
static const float GIZMO_LEN = 1.4f;
static const float GIZMO_HANDLE_RADIUS = 0.4f;

// Scene 3D + editeur : viewport libre (camera Unreal-like), selection des
// objets au clic gauche dans la scene (en plus de l'Outliner), et un gizmo
// de deplacement (fleches X/Y/Z) qu'on peut tirer pour bouger l'objet
// selectionne, comme dans Unreal/Unity.
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
        bool uiHasMouse = ImGui::GetIO().WantCaptureMouse;

        if (!uiHasMouse) {
            m_Camera.OnUpdate(ts);
        }

        UpdatePickingAndGizmo(uiHasMouse);

        m_Time += ts.GetSeconds();
        m_LastFrameTime = ts.GetSeconds();

        WEngine::Renderer::SetClearColor(0.06f, 0.07f, 0.10f, 1.0f);
        WEngine::Renderer::Clear();

        auto& window = WEngine::Application::Get().GetWindow();
        float aspect = (float)window.GetWidth() / (float)window.GetHeight();
        WEngine::Mat4 proj = WEngine::Mat4::Perspective(FOV_Y, aspect, 0.1f, 100.0f);
        WEngine::Mat4 viewProj = WEngine::Mat4::Multiply(proj, m_Camera.GetViewMatrix());

        m_Shader->Bind();
        m_Shader->SetMat4("u_ViewProj", viewProj.m);

        m_Shader->SetFloat3("u_Tint", 1.0f, 1.0f, 1.0f);
        m_Shader->SetMat4("u_Model", WEngine::Mat4::Identity().m);
        m_Grid->Draw();

        for (int i = 0; i < (int)m_Objects.size(); i++) {
            auto& obj = m_Objects[i];
            WEngine::Mat4 model = WEngine::Mat4::Multiply(
                WEngine::Mat4::Translate(obj.position),
                WEngine::Mat4::RotateY(m_Time * obj.rotationSpeed)
            );
            WEngine::Vec3 tint = obj.tint;
            if (i == m_Selected) tint = tint * 1.25f;
            m_Shader->SetFloat3("u_Tint", tint.x, tint.y, tint.z);
            m_Shader->SetMat4("u_Model", model.m);
            m_Cube->Draw();
        }

        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            DrawGizmo(m_Objects[m_Selected].position);
        }
    }

    void DrawGizmo(const WEngine::Vec3& pos) {
        DrawAxisArrow(pos, AXIS_X, 0.95f, 0.25f, 0.25f);
        DrawAxisArrow(pos, AXIS_Y, 0.25f, 0.95f, 0.3f);
        DrawAxisArrow(pos, AXIS_Z, 0.3f, 0.45f, 0.95f);
    }

    void DrawAxisArrow(const WEngine::Vec3& origin, const WEngine::Vec3& axis, float r, float g, float b) {
        float shaftLen = GIZMO_LEN * 0.7f, thick = 0.06f, headLen = GIZMO_LEN * 0.3f, headThick = 0.16f;

        WEngine::Vec3 shaftScale(
            axis.x != 0.0f ? shaftLen : thick,
            axis.y != 0.0f ? shaftLen : thick,
            axis.z != 0.0f ? shaftLen : thick);
        WEngine::Vec3 shaftPos = origin + axis * (shaftLen * 0.5f);
        WEngine::Mat4 shaftModel = WEngine::Mat4::Multiply(WEngine::Mat4::Translate(shaftPos), WEngine::Mat4::Scale(shaftScale));
        m_Shader->SetFloat3("u_Tint", r, g, b);
        m_Shader->SetMat4("u_Model", shaftModel.m);
        m_Cube->Draw();

        WEngine::Vec3 headScale(
            axis.x != 0.0f ? headLen : headThick,
            axis.y != 0.0f ? headLen : headThick,
            axis.z != 0.0f ? headLen : headThick);
        WEngine::Vec3 headPos = origin + axis * (shaftLen + headLen * 0.5f);
        WEngine::Mat4 headModel = WEngine::Mat4::Multiply(WEngine::Mat4::Translate(headPos), WEngine::Mat4::Scale(headScale));
        m_Shader->SetMat4("u_Model", headModel.m);
        m_Cube->Draw();
    }

    void UpdatePickingAndGizmo(bool uiHasMouse) {
        auto& window = WEngine::Application::Get().GetWindow();
        auto [mx, my] = WEngine::Input::GetMousePosition();
        WEngine::Ray ray = m_Camera.ScreenPointToRay(mx, my, (float)window.GetWidth(), (float)window.GetHeight(), FOV_Y);

        bool leftDown = !uiHasMouse && WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT);
        bool justPressed = leftDown && !m_LeftWasDown;
        m_LeftWasDown = leftDown;

        if (m_DraggingAxis >= 0) {
            if (!leftDown) {
                m_DraggingAxis = -1;
            } else {
                WEngine::Vec3 axis = m_DraggingAxis == 0 ? AXIS_X : (m_DraggingAxis == 1 ? AXIS_Y : AXIS_Z);
                WEngine::Vec3 camFwd = m_Camera.Forward();
                WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
                WEngine::Vec3 hit;
                if (WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) {
                    float t = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis);
                    m_Objects[m_Selected].position = m_DragOriginPos + axis * (t - m_DragStartOffset);
                }
            }
            return;
        }

        if (!justPressed) return;


        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            const WEngine::Vec3& objPos = m_Objects[m_Selected].position;
            struct { int axis; WEngine::Vec3 dir; } handles[3] = { {0, AXIS_X}, {1, AXIS_Y}, {2, AXIS_Z} };
            float bestT = 1e9f; int bestAxis = -1;
            for (auto& h : handles) {
                WEngine::Vec3 handleCenter = objPos + h.dir * (GIZMO_LEN * 0.75f);
                float t;
                if (WEngine::RaySphereIntersect(ray, handleCenter, GIZMO_HANDLE_RADIUS, t) && t < bestT) {
                    bestT = t; bestAxis = h.axis;
                }
            }
            if (bestAxis >= 0) {
                m_DraggingAxis = bestAxis;
                m_DragOriginPos = objPos;
                WEngine::Vec3 axis = bestAxis == 0 ? AXIS_X : (bestAxis == 1 ? AXIS_Y : AXIS_Z);
                WEngine::Vec3 camFwd = m_Camera.Forward();
                WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
                WEngine::Vec3 hit;
                m_DragStartOffset = 0.0f;
                if (WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) {
                    m_DragStartOffset = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis);
                }
                return;
            }
        }

        float bestT = 1e9f; int bestObj = -1;
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            float t;
            if (WEngine::RaySphereIntersect(ray, m_Objects[i].position, m_Objects[i].pickRadius, t) && t < bestT) {
                bestT = t; bestObj = i;
            }
        }
        m_Selected = bestObj;
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
            if (ImGui::Button("</> Ouvrir le script (N)", ImVec2(-1, 0))) {
                OpenScriptEditor(m_Selected);
            }
            ImGui::Separator();
            if (ImGui::Button("Supprimer", ImVec2(-1, 0))) {
                m_Objects.erase(m_Objects.begin() + m_Selected);
                m_Selected = -1;
            }
        } else {
            ImGui::TextDisabled("Selectionne un objet dans l'Outliner ou clique dessus dans la scene.");
        }
        ImGui::End();

        if (m_ShowScriptEditor && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            SceneObject& obj = m_Objects[m_ScriptTarget];
            std::string title = "</> Script - " + obj.name;
            ImGui::SetNextWindowSize(ImVec2(520, 380), ImGuiCond_FirstUseEver);
            if (ImGui::Begin(title.c_str(), &m_ShowScriptEditor)) {
                ImGui::TextDisabled("Code de \"%s\" (pas encore execute automatiquement)", obj.name.c_str());
                ImGui::Separator();
                ImGui::InputTextMultiline(
                    "##script", (char*)obj.script.c_str(), obj.script.capacity() + 1,
                    ImVec2(-1, -1),
                    ImGuiInputTextFlags_CallbackResize | ImGuiInputTextFlags_AllowTabInput,
                    ScriptEditCallback, &obj.script);
            }
            ImGui::End();
        }

        ImGui::Begin("Stats");
        ImGui::Text("FPS: %.0f", m_LastFrameTime > 0.0f ? 1.0f / m_LastFrameTime : 0.0f);
        ImGui::Text("Camera pos: %.1f, %.1f, %.1f", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        ImGui::Separator();
        ImGui::TextWrapped("Clic gauche sur un objet : le selectionner");
        ImGui::TextWrapped("Clic gauche + tirer une fleche du gizmo : le deplacer sur cet axe");
        ImGui::TextWrapped("Clic droit + souris : regarder autour, WASD : se deplacer, Q/E : monter/descendre, Shift : plus vite");
        ImGui::TextWrapped("Ces panneaux se deplacent et s'arriment ou tu veux (tire un titre).");
        ImGui::End();
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() == WEngine::EventType::KeyPressed) {
            auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
            constexpr int KEY_ESCAPE = 256;
            constexpr int KEY_N = 78;
            if (e.GetKeyCode() == KEY_ESCAPE) {
                WEngine::Application::Get().Close();
            }
            if (e.GetKeyCode() == KEY_N && !e.IsRepeat() && !ImGui::GetIO().WantTextInput
                && m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
                OpenScriptEditor(m_Selected);
            }
        }
    }

    void OpenScriptEditor(int index) {
        SceneObject& obj = m_Objects[index];
        if (obj.script.empty()) {
            char buf[1024];
            snprintf(buf, sizeof(buf), DEFAULT_SCRIPT_TEMPLATE, obj.name.c_str());
            obj.script = buf;
        }
        m_ScriptTarget = index;
        m_ShowScriptEditor = true;
    }

private:
    static constexpr float FOV_Y = 45.0f * 3.14159265f / 180.0f;

    std::unique_ptr<WEngine::Shader> m_Shader;
    std::unique_ptr<WEngine::Mesh> m_Cube;
    std::unique_ptr<WEngine::Mesh> m_Grid;
    std::vector<SceneObject> m_Objects;
    int m_Selected = -1;
    int m_NextId = 5;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;

    bool m_LeftWasDown = false;
    int m_DraggingAxis = -1;
    WEngine::Vec3 m_DragOriginPos;
    float m_DragStartOffset = 0.0f;

    bool m_ShowScriptEditor = false;
    int m_ScriptTarget = -1;
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
