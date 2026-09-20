#include <Engine.h>
#include <vector>
#include <memory>
#include <string>
#include <unordered_map>
#include <cstdio>
#include <cmath>
#include <filesystem>
#include <cctype>
#include <algorithm>

#include <GLFW/glfw3.h>

namespace fs = std::filesystem;

// --- Shaders ---------------------------------------------------------
// Position + normale (eclairage) + UV (texture) + couleur de base.
// u_Lit : desactive l'eclairage pour la grille/le gizmo (elements d'UI,
// pas des objets de la scene). u_UseTexture : si vrai, la couleur vient
// de u_Texture au lieu de la couleur du vertex.
static const char* VERTEX_SRC = R"(
#version 330 core
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_UV;
layout(location = 3) in vec3 a_Color;

uniform mat4 u_ViewProj;
uniform mat4 u_Model;
uniform mat4 u_NormalMatrix;

out vec3 v_Color;
out vec3 v_Normal;
out vec2 v_UV;
out vec3 v_WorldPos;

void main() {
    v_Color = a_Color;
    v_UV = a_UV;
    v_Normal = mat3(u_NormalMatrix) * a_Normal;
    vec4 worldPos = u_Model * vec4(a_Position, 1.0);
    v_WorldPos = worldPos.xyz;
    gl_Position = u_ViewProj * worldPos;
}
)";

static const char* FRAGMENT_SRC = R"(
#version 330 core
in vec3 v_Color;
in vec3 v_Normal;
in vec2 v_UV;
in vec3 v_WorldPos;
out vec4 FragColor;

uniform vec3 u_Tint;
uniform int u_Lit;
uniform int u_UseTexture;
uniform sampler2D u_Texture;
uniform vec3 u_LightDir;
uniform vec3 u_ViewPos;

void main() {
    vec3 baseColor = (u_UseTexture != 0) ? texture(u_Texture, v_UV).rgb : v_Color;
    vec3 color = baseColor * u_Tint;

    if (u_Lit != 0) {
        vec3 N = normalize(v_Normal);
        vec3 L = normalize(-u_LightDir);
        float diff = max(dot(N, L), 0.0);
        vec3 viewDir = normalize(u_ViewPos - v_WorldPos);
        vec3 halfDir = normalize(L + viewDir);
        float spec = pow(max(dot(N, halfDir), 0.0), 24.0);
        float ambient = 0.38;
        vec3 lit = color * (ambient + diff * 0.72) + vec3(1.0) * spec * 0.12;
        FragColor = vec4(lit, 1.0);
    } else {
        FragColor = vec4(color, 1.0);
    }
}
)";

// Blueprint visuel : une chaine de blocs (pas de lignes de code) qu'on
// glisse dans un canvas, comme les evenements/actions d'Unreal. Chaque
// objet a sa propre liste de blocs ; l'ordre de la liste = ordre
// d'execution (pas encore execute automatiquement pendant le jeu, mais
// c'est bien un editeur visuel, plus du texte).
struct BlueprintNode {
    int type = 0;
    ImVec2 pos{ 0.0f, 0.0f };
};

struct NodeTypeInfo { const char* label; const char* shortLabel; ImU32 color; };
static const NodeTypeInfo NODE_TYPES[] = {
    { "Evenement : Collision avec le Joueur", "Collision",  IM_COL32(150, 100, 220, 255) },
    { "Action : -1 Vie",                       "-1 Vie",     IM_COL32(210, 90, 90, 255) },
    { "Action : Repousser le joueur",          "Repousser",  IM_COL32(230, 150, 60, 255) },
    { "Condition : Vie <= 0 ?",                "Vie<=0?",    IM_COL32(230, 210, 60, 255) },
    { "Action : Redemarrer le niveau",         "Redemarrer", IM_COL32(80, 140, 230, 255) },
};

static const char* SHAPE_NAMES[] = { "Cube", "Sphere", "Cylindre", "Camera", "Texte" };
enum ShapeType { Shape_Cube = 0, Shape_Sphere = 1, Shape_Cylinder = 2, Shape_Camera = 3, Shape_Text = 4 };

struct SceneObject {
    std::string name;
    WEngine::Vec3 position;
    WEngine::Vec3 tint{ 1.0f, 1.0f, 1.0f };
    float rotationSpeed = 0.0f;
    float pickRadius = 0.9f;
    std::vector<BlueprintNode> blueprint;
    int shape = Shape_Cube;
    WEngine::Vec3 rotationEuler{ 0.0f, 0.0f, 0.0f }; // degres ; pour une Camera : x=pitch, y=yaw
    WEngine::Vec3 scale{ 1.0f, 1.0f, 1.0f };
    std::string texturePath; // vide = pas de texture, couleur unie
    std::string text = "Texte"; // utilise seulement si shape == Shape_Text
};

static int TextEditCallback(ImGuiInputTextCallbackData* data) {
    if (data->EventFlag == ImGuiInputTextFlags_CallbackResize) {
        std::string* str = (std::string*)data->UserData;
        str->resize(data->BufTextLen);
        data->Buf = (char*)str->c_str();
    }
    return 0;
}

static constexpr float DEG2RAD = 3.14159265f / 180.0f;

static const WEngine::Vec3 AXIS_X(1.0f, 0.0f, 0.0f);
static const WEngine::Vec3 AXIS_Y(0.0f, 1.0f, 0.0f);
static const WEngine::Vec3 AXIS_Z(0.0f, 0.0f, 1.0f);
static const float GIZMO_LEN = 1.4f;
static const float GIZMO_HANDLE_RADIUS = 0.4f;

static float Clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

// Scene 3D + editeur : viewport libre (camera Unreal-like), selection des
// objets au clic gauche dans la scene (en plus de l'Outliner), un gizmo de
// deplacement (fleches X/Y/Z), eclairage temps reel, textures depuis un
// dossier "assets", des objets Camera/Texte en plus des formes, et un
// personnage jouable optionnel qui peut sauter sur les plateformes de la
// scene (n'importe quel objet sert de plateforme, comme dans un editeur).
class Scene3DLayer : public WEngine::Layer {
public:
    Scene3DLayer() : Layer("Scene3D") {
        m_Shader = std::make_unique<WEngine::Shader>(VERTEX_SRC, FRAGMENT_SRC);
        m_Cube.reset(WEngine::Mesh::CreateCube());
        m_Sphere.reset(WEngine::Mesh::CreateSphere());
        m_Cylinder.reset(WEngine::Mesh::CreateCylinder());
        m_Grid.reset(WEngine::Mesh::CreateGrid(10, 1.0f));

        m_Objects.push_back({ "Cube 1", {0.0f, 0.5f, 0.0f}, {0.85f,0.35f,0.35f} });
        m_Objects.push_back({ "Cube 2", {2.5f, 0.5f, -1.5f}, {0.35f,0.65f,0.9f} });
        m_Objects.push_back({ "Cube 3", {-2.0f, 1.0f, 1.0f}, {0.4f,0.85f,0.55f} });
        m_Objects.push_back({ "Cube 4", {1.0f, 1.5f, 3.0f}, {0.95f,0.75f,0.25f} });
        m_Objects.push_back({ "Cube 5", {-3.0f, 0.5f, -2.5f}, {0.7f,0.5f,0.9f} });

        auto addPlatform = [&](const char* name, WEngine::Vec3 pos, WEngine::Vec3 scale) {
            SceneObject p;
            p.name = name;
            p.position = pos;
            p.scale = scale;
            p.tint = { 0.55f, 0.53f, 0.5f };
            m_Objects.push_back(p);
        };
        addPlatform("Plateforme 1", { 4.0f, 0.5f, -3.0f }, { 2.2f, 1.0f, 2.2f });
        addPlatform("Plateforme 2", { 7.0f, 1.5f, -5.0f }, { 2.2f, 1.0f, 2.2f });
        addPlatform("Plateforme 3", { 10.0f, 2.5f, -3.0f }, { 2.2f, 1.0f, 2.2f });
        addPlatform("Plateforme 4", { 10.0f, 3.5f, 1.0f }, { 2.2f, 1.0f, 2.2f });
        addPlatform("Plateforme 5", { 7.0f, 4.5f, 3.0f }, { 2.6f, 1.0f, 2.6f });

        SceneObject camObj;
        camObj.name = "Camera 1";
        camObj.shape = Shape_Camera;
        camObj.position = { -4.5f, 1.8f, 0.5f };
        camObj.rotationEuler = { -8.0f, 20.0f, 0.0f };
        m_Objects.push_back(camObj);

        SceneObject textObj;
        textObj.name = "Texte 1";
        textObj.shape = Shape_Text;
        textObj.text = "WEngine Demo";
        textObj.position = { 0.0f, 3.2f, 0.0f };
        textObj.tint = { 1.0f, 1.0f, 1.0f };
        m_Objects.push_back(textObj);

        RefreshTextureList();
    }

    void OnUpdate(WEngine::Timestep ts) override {
        bool uiHasMouse = ImGui::GetIO().WantCaptureMouse;

        if (m_PlayerMode) {
            UpdatePlayer(ts, uiHasMouse);
        } else {
            if (!uiHasMouse) {
                m_Camera.OnUpdate(ts);
            }
            UpdatePickingAndGizmo(uiHasMouse);
        }

        m_Time += ts.GetSeconds();
        m_LastFrameTime = ts.GetSeconds();

        WEngine::Renderer::SetClearColor(0.45f, 0.6f, 0.78f, 1.0f);
        WEngine::Renderer::Clear();

        auto& window = WEngine::Application::Get().GetWindow();
        m_ViewportW = (float)window.GetWidth();
        m_ViewportH = (float)window.GetHeight();
        float aspect = m_ViewportW / m_ViewportH;
        WEngine::Mat4 proj = WEngine::Mat4::Perspective(FOV_Y, aspect, 0.1f, 150.0f);
        m_LastViewProj = WEngine::Mat4::Multiply(proj, m_Camera.GetViewMatrix());

        m_Shader->Bind();
        m_Shader->SetMat4("u_ViewProj", m_LastViewProj.m);
        m_Shader->SetFloat3("u_LightDir", -0.35f, -1.0f, -0.25f);
        m_Shader->SetFloat3("u_ViewPos", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        m_Shader->SetInt("u_Texture", 0);

        // Grille : non eclairee, couleur fixe.
        m_Shader->SetInt("u_Lit", 0);
        m_Shader->SetInt("u_UseTexture", 0);
        m_Shader->SetFloat3("u_Tint", 1.0f, 1.0f, 1.0f);
        SetModel(WEngine::Mat4::Identity());
        m_Grid->Draw();

        for (int i = 0; i < (int)m_Objects.size(); i++) {
            auto& obj = m_Objects[i];
            if (obj.shape == Shape_Text) continue; // rendu en overlay 2D (OnImGuiRender)
            if (obj.shape == Shape_Camera) { DrawCameraMarker(obj, i == m_Selected); continue; }

            WEngine::Mat4 rot = WEngine::Mat4::Multiply(
                WEngine::Mat4::RotateY(m_Time * obj.rotationSpeed + obj.rotationEuler.y * DEG2RAD),
                WEngine::Mat4::Multiply(
                    WEngine::Mat4::RotateX(obj.rotationEuler.x * DEG2RAD),
                    WEngine::Mat4::RotateZ(obj.rotationEuler.z * DEG2RAD)));
            WEngine::Mat4 model = WEngine::Mat4::Multiply(
                WEngine::Mat4::Multiply(WEngine::Mat4::Translate(obj.position), rot),
                WEngine::Mat4::Scale(obj.scale)
            );
            WEngine::Vec3 tint = obj.tint;
            if (i == m_Selected) {
                tint = { Clamp01(tint.x * 1.25f), Clamp01(tint.y * 1.25f), Clamp01(tint.z * 1.25f) };
            }

            WEngine::Texture* tex = obj.texturePath.empty() ? nullptr : GetTexture(obj.texturePath);
            m_Shader->SetInt("u_Lit", 1);
            if (tex) {
                tex->Bind(0);
                m_Shader->SetInt("u_UseTexture", 1);
            } else {
                m_Shader->SetInt("u_UseTexture", 0);
            }
            m_Shader->SetFloat3("u_Tint", tint.x, tint.y, tint.z);
            SetModel(model);
            MeshFor(obj.shape)->Draw();
        }

        if (!m_PlayerMode && m_Selected >= 0 && m_Selected < (int)m_Objects.size()
            && m_Objects[m_Selected].shape != Shape_Text) {
            DrawGizmo(m_Objects[m_Selected].position);
        }

        if (m_PlayerMode) {
            DrawPlayer();
        }
    }

    void SetModel(const WEngine::Mat4& model) {
        m_Shader->SetMat4("u_Model", model.m);
        WEngine::Mat4 normalMat = model;
        normalMat.m[12] = 0.0f; normalMat.m[13] = 0.0f; normalMat.m[14] = 0.0f;
        m_Shader->SetMat4("u_NormalMatrix", normalMat.m);
    }

    WEngine::Mesh* MeshFor(int shape) {
        if (shape == Shape_Sphere) return m_Sphere.get();
        if (shape == Shape_Cylinder) return m_Cylinder.get();
        return m_Cube.get();
    }

    WEngine::Texture* GetTexture(const std::string& path) {
        auto it = m_TextureCache.find(path);
        if (it != m_TextureCache.end()) return it->second->IsValid() ? it->second.get() : nullptr;
        auto tex = std::make_unique<WEngine::Texture>(path);
        WEngine::Texture* ptr = tex->IsValid() ? tex.get() : nullptr;
        m_TextureCache[path] = std::move(tex);
        return ptr;
    }

    void RefreshTextureList() {
        m_AvailableTextures.clear();
        std::error_code ec;
        fs::path dir = "assets";
        if (!fs::exists(dir, ec)) fs::create_directories(dir, ec);
        if (!fs::exists(dir, ec)) return;
        for (auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec || !entry.is_regular_file()) continue;
            std::string ext = entry.path().extension().string();
            for (auto& c : ext) c = (char)std::tolower((unsigned char)c);
            if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp") {
                m_AvailableTextures.push_back(entry.path().string());
            }
        }
    }

    void DrawCameraMarker(const SceneObject& obj, bool selected) {
        WEngine::Mat4 base = WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate(obj.position), WEngine::Mat4::RotateY(obj.rotationEuler.y * DEG2RAD));
        WEngine::Vec3 tint = selected ? WEngine::Vec3(1.0f, 0.95f, 0.4f) : WEngine::Vec3(0.2f, 0.2f, 0.25f);

        m_Shader->SetInt("u_Lit", 0);
        m_Shader->SetInt("u_UseTexture", 0);
        m_Shader->SetFloat3("u_Tint", tint.x, tint.y, tint.z);

        WEngine::Mat4 body = WEngine::Mat4::Multiply(base, WEngine::Mat4::Scale({ 0.5f, 0.35f, 0.35f }));
        SetModel(body);
        m_Cube->Draw();

        WEngine::Mat4 lens = WEngine::Mat4::Multiply(base, WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate({ 0.0f, 0.0f, -0.35f }),
            WEngine::Mat4::Multiply(WEngine::Mat4::RotateX(90.0f * DEG2RAD), WEngine::Mat4::Scale({ 0.22f, 0.3f, 0.22f }))));
        SetModel(lens);
        m_Cylinder->Draw();
    }

    bool WorldToScreen(const WEngine::Vec3& worldPos, ImVec2& outScreen) {
        const float* m = m_LastViewProj.m;
        float x = worldPos.x, y = worldPos.y, z = worldPos.z;
        float clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
        float clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
        float clipW = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (clipW <= 0.0001f) return false;
        float ndcX = clipX / clipW, ndcY = clipY / clipW;
        outScreen.x = (ndcX * 0.5f + 0.5f) * m_ViewportW;
        outScreen.y = (1.0f - (ndcY * 0.5f + 0.5f)) * m_ViewportH;
        return true;
    }

    // ---- Personnage jouable : mouvement, saut, animation procedurale ----

    float SurfaceHeightAt(float x, float z, float refY) {
        float best = 0.0f; // sol de base (grille, y=0)
        for (auto& obj : m_Objects) {
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text) continue;
            float halfX = std::fabs(obj.scale.x) * 0.5f, halfZ = std::fabs(obj.scale.z) * 0.5f;
            if (x >= obj.position.x - halfX && x <= obj.position.x + halfX &&
                z >= obj.position.z - halfZ && z <= obj.position.z + halfZ) {
                float topY = obj.position.y + obj.scale.y * 0.5f;
                if (topY <= refY + 0.2f && topY > best) best = topY;
            }
        }
        return best;
    }

    void UpdatePlayer(WEngine::Timestep ts, bool uiHasMouse) {
        if (!uiHasMouse) {
            m_Camera.OnUpdateLookOnly(ts);
        }

        WEngine::Vec3 fwd = m_Camera.Forward(); fwd.y = 0.0f; fwd = fwd.Normalized();
        WEngine::Vec3 right = m_Camera.Right(); right.y = 0.0f; right = right.Normalized();

        WEngine::Vec3 move{ 0.0f, 0.0f, 0.0f };
        if (!uiHasMouse) {
            if (WEngine::Input::IsKeyPressed(GLFW_KEY_W)) move = move + fwd;
            if (WEngine::Input::IsKeyPressed(GLFW_KEY_S)) move = move - fwd;
            if (WEngine::Input::IsKeyPressed(GLFW_KEY_D)) move = move + right;
            if (WEngine::Input::IsKeyPressed(GLFW_KEY_A)) move = move - right;
        }
        m_PlayerMoving = (move.x != 0.0f || move.z != 0.0f);
        if (m_PlayerMoving) {
            move = move.Normalized();
            float speed = 5.0f * ts.GetSeconds();
            m_PlayerPos = m_PlayerPos + move * speed;
            m_PlayerFacingYaw = std::atan2(move.x, move.z);
            m_WalkCycle += ts.GetSeconds() * 10.0f;
        }

        constexpr float GRAVITY = 20.0f, JUMP_SPEED = 8.0f, PLAYER_HALF_HEIGHT = 1.0f;
        bool wasGrounded = m_PlayerGrounded;
        if (!uiHasMouse && m_PlayerGrounded && WEngine::Input::IsKeyPressed(GLFW_KEY_SPACE)) {
            m_PlayerVelY = JUMP_SPEED;
            m_PlayerGrounded = false;
        }
        m_PlayerVelY -= GRAVITY * ts.GetSeconds();
        float feetBefore = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        m_PlayerPos.y += m_PlayerVelY * ts.GetSeconds();
        float feetAfter = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        float ground = SurfaceHeightAt(m_PlayerPos.x, m_PlayerPos.z, feetBefore);
        if (feetAfter <= ground) {
            m_PlayerPos.y = ground + PLAYER_HALF_HEIGHT;
            m_PlayerVelY = 0.0f;
            m_PlayerGrounded = true;
        } else {
            m_PlayerGrounded = false;
        }
        if (!wasGrounded && m_PlayerGrounded) m_SquashTimer = 0.15f;
        if (m_SquashTimer > 0.0f) {
            m_SquashTimer -= ts.GetSeconds();
            if (m_SquashTimer < 0.0f) m_SquashTimer = 0.0f;
        }

        WEngine::Vec3 camOffset = m_Camera.Forward() * -5.0f + WEngine::Vec3(0.0f, 2.0f, 0.0f);
        m_Camera.Position = m_PlayerPos + camOffset;
    }

    void DrawPart(const WEngine::Mat4& base, WEngine::Vec3 localPos, WEngine::Vec3 scale, WEngine::Vec3 tint, WEngine::Mesh* mesh) {
        WEngine::Mat4 model = WEngine::Mat4::Multiply(base,
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(localPos), WEngine::Mat4::Scale(scale)));
        m_Shader->SetInt("u_Lit", 1);
        m_Shader->SetInt("u_UseTexture", 0);
        m_Shader->SetFloat3("u_Tint", tint.x, tint.y, tint.z);
        SetModel(model);
        mesh->Draw();
    }

    void DrawLimb(const WEngine::Mat4& base, WEngine::Vec3 pivotLocal, float angleRad, float length, float thickness, WEngine::Vec3 tint) {
        WEngine::Mat4 model = WEngine::Mat4::Multiply(base,
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(pivotLocal),
            WEngine::Mat4::Multiply(WEngine::Mat4::RotateX(angleRad),
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate({ 0.0f, -length * 0.5f, 0.0f }), WEngine::Mat4::Scale({ thickness, length, thickness })))));
        m_Shader->SetInt("u_Lit", 1);
        m_Shader->SetInt("u_UseTexture", 0);
        m_Shader->SetFloat3("u_Tint", tint.x, tint.y, tint.z);
        SetModel(model);
        m_Cylinder->Draw();
    }

    void DrawPlayer() {
        WEngine::Mat4 base = WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate(m_PlayerPos), WEngine::Mat4::RotateY(m_PlayerFacingYaw));

        float squashY = 1.0f, squashXZ = 1.0f;
        if (m_SquashTimer > 0.0f) {
            float t = m_SquashTimer / 0.15f;
            squashY = 1.0f - 0.3f * t;
            squashXZ = 1.0f + 0.2f * t;
        } else if (!m_PlayerGrounded && m_PlayerVelY > 0.0f) {
            squashY = 1.12f; squashXZ = 0.9f;
        }

        float legSwing = m_PlayerMoving ? std::sin(m_WalkCycle) * 0.6f : std::sin(m_Time * 1.5f) * 0.05f;
        float armSwing = -legSwing;
        float headBob = m_PlayerMoving ? std::fabs(std::sin(m_WalkCycle * 2.0f)) * 0.05f : std::sin(m_Time * 1.2f) * 0.02f;

        WEngine::Vec3 skin(0.95f, 0.8f, 0.65f), shirt(0.3f, 0.55f, 0.9f), pants(0.25f, 0.3f, 0.4f);

        DrawPart(base, { 0.0f, 0.0f, 0.0f }, { 0.5f * squashXZ, 0.95f * squashY, 0.5f * squashXZ }, shirt, m_Cylinder.get());
        DrawPart(base, { 0.0f, 0.78f * squashY + headBob, 0.0f }, { 0.42f, 0.42f, 0.42f }, skin, m_Sphere.get());
        DrawLimb(base, { 0.42f, 0.35f * squashY, 0.0f }, armSwing, 0.65f, 0.16f, shirt);
        DrawLimb(base, { -0.42f, 0.35f * squashY, 0.0f }, -armSwing, 0.65f, 0.16f, shirt);
        DrawLimb(base, { 0.2f, -0.45f * squashY, 0.0f }, -legSwing, 0.75f, 0.2f, pants);
        DrawLimb(base, { -0.2f, -0.45f * squashY, 0.0f }, legSwing, 0.75f, 0.2f, pants);
    }

    // ---- Gizmo de deplacement ----

    void DrawGizmo(const WEngine::Vec3& pos) {
        m_Shader->SetInt("u_Lit", 0);
        m_Shader->SetInt("u_UseTexture", 0);
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
        SetModel(shaftModel);
        m_Cube->Draw();

        WEngine::Vec3 headScale(
            axis.x != 0.0f ? headLen : headThick,
            axis.y != 0.0f ? headLen : headThick,
            axis.z != 0.0f ? headLen : headThick);
        WEngine::Vec3 headPos = origin + axis * (shaftLen + headLen * 0.5f);
        WEngine::Mat4 headModel = WEngine::Mat4::Multiply(WEngine::Mat4::Translate(headPos), WEngine::Mat4::Scale(headScale));
        SetModel(headModel);
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
            if (m_Objects[i].shape == Shape_Text) continue;
            float t;
            if (WEngine::RaySphereIntersect(ray, m_Objects[i].position, m_Objects[i].pickRadius, t) && t < bestT) {
                bestT = t; bestObj = i;
            }
        }
        m_Selected = bestObj;
    }

    // ---- Interface ----

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
        ImGui::Combo("Forme", &m_NewShape, SHAPE_NAMES, IM_ARRAYSIZE(SHAPE_NAMES));
        if (ImGui::Button("+ Ajouter", ImVec2(-1, 0))) {
            WEngine::Vec3 spawnPos = m_Camera.Position + m_Camera.Forward() * 4.0f;
            SceneObject obj;
            obj.name = std::string(SHAPE_NAMES[m_NewShape]) + " " + std::to_string(++m_NextId);
            obj.position = spawnPos;
            obj.tint = { 0.8f, 0.8f, 0.8f };
            obj.shape = m_NewShape;
            if (m_NewShape == Shape_Text) obj.text = "Nouveau texte";
            m_Objects.push_back(obj);
            m_Selected = (int)m_Objects.size() - 1;
        }
        ImGui::End();

        ImGui::Begin("Inspecteur");
        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            SceneObject& obj = m_Objects[m_Selected];
            ImGui::Text("%s", obj.name.c_str());
            ImGui::Separator();
            ImGui::Combo("Forme", &obj.shape, SHAPE_NAMES, IM_ARRAYSIZE(SHAPE_NAMES));
            ImGui::DragFloat3("Position", &obj.position.x, 0.05f);

            if (obj.shape == Shape_Camera) {
                ImGui::DragFloat("Pitch (deg)", &obj.rotationEuler.x, 0.5f, -89.0f, 89.0f);
                ImGui::DragFloat("Yaw (deg)", &obj.rotationEuler.y, 0.5f);
                if (ImGui::Button("Voir depuis cette camera", ImVec2(-1, 0))) {
                    m_Camera.Position = obj.position;
                    m_Camera.Yaw = obj.rotationEuler.y;
                    m_Camera.Pitch = obj.rotationEuler.x;
                }
            } else {
                ImGui::DragFloat3("Rotation (deg)", &obj.rotationEuler.x, 0.5f);
                ImGui::DragFloat3("Echelle", &obj.scale.x, 0.02f, 0.05f, 12.0f);
                ImGui::ColorEdit3("Couleur", &obj.tint.x);
                ImGui::DragFloat("Vitesse rotation auto", &obj.rotationSpeed, 0.02f, 0.0f, 5.0f);
            }

            if (obj.shape == Shape_Text) {
                ImGui::InputText("Texte", (char*)obj.text.c_str(), obj.text.capacity() + 1,
                    ImGuiInputTextFlags_CallbackResize, TextEditCallback, &obj.text);
            }

            if (obj.shape == Shape_Cube || obj.shape == Shape_Sphere || obj.shape == Shape_Cylinder) {
                ImGui::Separator();
                if (obj.texturePath.empty()) {
                    ImGui::TextDisabled("Pas de texture (voir panneau Textures)");
                } else {
                    ImGui::Text("Texture : %s", fs::path(obj.texturePath).filename().string().c_str());
                    if (ImGui::Button("Retirer la texture", ImVec2(-1, 0))) obj.texturePath.clear();
                }
            }

            ImGui::Separator();
            if (ImGui::Button("Blueprint visuel (N)", ImVec2(-1, 0))) {
                OpenBlueprintEditor(m_Selected);
            }
            ImGui::Separator();
            if (ImGui::Button("Supprimer (Suppr)", ImVec2(-1, 0))) {
                DeleteSelected();
            }
        } else {
            ImGui::TextDisabled("Selectionne un objet dans l'Outliner ou clique dessus dans la scene.");
        }
        ImGui::End();

        ImGui::Begin("Textures");
        ImGui::TextWrapped("Depose des images (.png/.jpg/.bmp) dans le dossier \"assets\" a cote de l'executable, puis Rafraichir. Clique une image pour l'appliquer a l'objet selectionne.");
        if (ImGui::Button("Rafraichir", ImVec2(-1, 0))) RefreshTextureList();
        ImGui::Separator();
        if (m_AvailableTextures.empty()) {
            ImGui::TextDisabled("Aucune image dans /assets pour l'instant.");
        } else {
            for (auto& path : m_AvailableTextures) {
                std::string label = fs::path(path).filename().string();
                bool isCurrent = (m_Selected >= 0 && m_Selected < (int)m_Objects.size() && m_Objects[m_Selected].texturePath == path);
                if (ImGui::Selectable(label.c_str(), isCurrent)) {
                    if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
                        SceneObject& obj = m_Objects[m_Selected];
                        if (obj.shape == Shape_Cube || obj.shape == Shape_Sphere || obj.shape == Shape_Cylinder) {
                            obj.texturePath = path;
                        }
                    }
                }
            }
        }
        ImGui::End();

        if (m_ShowScriptEditor && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            DrawBlueprintEditor(m_Objects[m_ScriptTarget]);
        }

        ImGui::Begin("Jouer");
        {
            bool wasOn = m_PlayerMode;
            ImVec4 col = m_PlayerMode ? ImVec4(0.75f, 0.2f, 0.2f, 1.0f) : ImVec4(0.2f, 0.65f, 0.25f, 1.0f);
            ImGui::PushStyleColor(ImGuiCol_Button, col);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, col);
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, col);
            if (ImGui::Button(m_PlayerMode ? "■  Arreter (F5)" : "▶  Lancer le jeu (F5)", ImVec2(-1, 48))) {
                m_PlayerMode = !m_PlayerMode;
            }
            ImGui::PopStyleColor(3);
            if (m_PlayerMode && !wasOn) {
                m_PlayerPos = m_Camera.Position + m_Camera.Forward() * 3.0f;
                m_PlayerPos.y = 1.0f;
                m_PlayerVelY = 0.0f;
                m_PlayerGrounded = true;
            }
        }
        ImGui::Separator();
        if (m_PlayerMode) {
            ImGui::TextWrapped("WASD : marcher, Espace : sauter, Clic droit + souris : orbiter la camera. Tous les objets de la scene servent de plateformes.");
        } else {
            ImGui::TextWrapped("Personnage jouable pre-fabrique (deplacement + saut + animation + camera 3e personne), code deja ecrit pour gagner du temps.");
        }
        ImGui::End();

        ImGui::Begin("Stats");
        ImGui::Text("FPS: %.0f", m_LastFrameTime > 0.0f ? 1.0f / m_LastFrameTime : 0.0f);
        ImGui::Text("Camera pos: %.1f, %.1f, %.1f", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        ImGui::Separator();
        ImGui::TextWrapped("Clic gauche sur un objet : le selectionner");
        ImGui::TextWrapped("Clic gauche + tirer une fleche du gizmo : le deplacer sur cet axe");
        ImGui::TextWrapped("Suppr : supprimer l'objet selectionne");
        ImGui::TextWrapped("N : ouvrir son Blueprint visuel");
        ImGui::TextWrapped("F5 ou panneau Jouer : lancer/arreter le jeu");
        ImGui::TextWrapped("Clic droit + souris : regarder autour, WASD : se deplacer, Q/E : monter/descendre, Shift : plus vite");
        ImGui::TextWrapped("Ces panneaux se deplacent et s'arriment ou tu veux (tire un titre).");
        ImGui::End();

        // Labels "Texte" projetes du monde 3D vers l'ecran, par-dessus tout le reste.
        ImDrawList* fg = ImGui::GetForegroundDrawList();
        for (auto& obj : m_Objects) {
            if (obj.shape != Shape_Text) continue;
            ImVec2 screen;
            if (!WorldToScreen(obj.position, screen)) continue;
            float size = 18.0f * (obj.scale.x > 0.2f ? obj.scale.x : 1.0f);
            ImU32 col = IM_COL32((int)(Clamp01(obj.tint.x) * 255), (int)(Clamp01(obj.tint.y) * 255), (int)(Clamp01(obj.tint.z) * 255), 255);
            ImVec2 textSize = ImGui::CalcTextSize(obj.text.c_str());
            ImVec2 pos = { screen.x - textSize.x * 0.5f, screen.y };
            fg->AddText(nullptr, size, ImVec2(pos.x + 1, pos.y + 1), IM_COL32(0, 0, 0, 180), obj.text.c_str());
            fg->AddText(nullptr, size, pos, col, obj.text.c_str());
        }
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() == WEngine::EventType::KeyPressed) {
            auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
            constexpr int KEY_ESCAPE = 256;
            constexpr int KEY_DELETE = 261;
            constexpr int KEY_N = 78;
            constexpr int KEY_F5 = 294;
            bool typing = ImGui::GetIO().WantTextInput;

            if (e.GetKeyCode() == KEY_ESCAPE) {
                WEngine::Application::Get().Close();
            }
            if (e.GetKeyCode() == KEY_N && !e.IsRepeat() && !typing
                && m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
                OpenBlueprintEditor(m_Selected);
            }
            if (e.GetKeyCode() == KEY_DELETE && !e.IsRepeat() && !typing) {
                DeleteSelected();
            }
            if (e.GetKeyCode() == KEY_F5 && !e.IsRepeat()) {
                m_PlayerMode = !m_PlayerMode;
                if (m_PlayerMode) {
                    m_PlayerPos = m_Camera.Position + m_Camera.Forward() * 3.0f;
                    m_PlayerPos.y = 1.0f;
                    m_PlayerVelY = 0.0f;
                    m_PlayerGrounded = true;
                }
            }
        }
    }

    void DeleteSelected() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        m_Objects.erase(m_Objects.begin() + m_Selected);
        m_Selected = -1;
        m_ShowScriptEditor = false;
    }

    void OpenBlueprintEditor(int index) {
        SceneObject& obj = m_Objects[index];
        if (obj.blueprint.empty()) {
            for (int i = 0; i < IM_ARRAYSIZE(NODE_TYPES); i++) {
                BlueprintNode n;
                n.type = i;
                n.pos = ImVec2(30.0f, 30.0f + (float)i * 96.0f);
                obj.blueprint.push_back(n);
            }
        }
        m_ScriptTarget = index;
        m_ShowScriptEditor = true;
    }

    // Editeur de logique visuel a base de blocs : glisser-deposer, pas de
    // ligne de code. L'ordre des blocs dans la liste = ordre d'execution
    // (represente par les fleches entre eux). Pas encore execute
    // automatiquement pendant le jeu.
    void DrawBlueprintEditor(SceneObject& obj) {
        std::string title = "Blueprint - " + obj.name;
        ImGui::SetNextWindowSize(ImVec2(600, 480), ImGuiCond_FirstUseEver);
        if (!ImGui::Begin(title.c_str(), &m_ShowScriptEditor)) { ImGui::End(); return; }

        ImGui::TextWrapped("Glisse les blocs pour organiser la logique. Ajoute-en avec les boutons ci-dessous.");
        ImGui::Separator();

        for (int t = 0; t < IM_ARRAYSIZE(NODE_TYPES); t++) {
            if (t > 0) ImGui::SameLine();
            ImGui::PushID(t);
            std::string label = std::string("+ ") + NODE_TYPES[t].shortLabel;
            if (ImGui::SmallButton(label.c_str())) {
                BlueprintNode n;
                n.type = t;
                n.pos = ImVec2(30.0f, 30.0f + (float)obj.blueprint.size() * 40.0f);
                obj.blueprint.push_back(n);
            }
            ImGui::PopID();
        }
        ImGui::Separator();

        ImVec2 visibleSize = ImGui::GetContentRegionAvail();
        if (visibleSize.x < 100.0f) visibleSize.x = 100.0f;
        if (visibleSize.y < 100.0f) visibleSize.y = 100.0f;

        ImGui::BeginChild("##bp_canvas_child", visibleSize, true, ImGuiWindowFlags_HorizontalScrollbar);

        const ImVec2 nodeSizeForBounds(230.0f, 56.0f);
        float contentH = 30.0f;
        for (auto& n : obj.blueprint) contentH = std::max(contentH, n.pos.y + nodeSizeForBounds.y + 20.0f);
        ImVec2 canvasSize = ImGui::GetContentRegionAvail();
        if (canvasSize.y < contentH) canvasSize.y = contentH;

        ImVec2 canvasPos = ImGui::GetCursorScreenPos();
        ImGui::InvisibleButton("##bp_canvas_bg", canvasSize);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        dl->PushClipRect(canvasPos, ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y), true);
        dl->AddRectFilled(canvasPos, ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y), IM_COL32(28, 28, 36, 255));
        for (float gx = 0.0f; gx < canvasSize.x; gx += 24.0f)
            for (float gy = 0.0f; gy < canvasSize.y; gy += 24.0f)
                dl->AddCircleFilled(ImVec2(canvasPos.x + gx, canvasPos.y + gy), 1.0f, IM_COL32(70, 70, 85, 255));

        const ImVec2 nodeSize(230.0f, 56.0f);

        for (int i = 0; i + 1 < (int)obj.blueprint.size(); i++) {
            ImVec2 a = { canvasPos.x + obj.blueprint[i].pos.x + nodeSize.x * 0.5f, canvasPos.y + obj.blueprint[i].pos.y + nodeSize.y };
            ImVec2 b = { canvasPos.x + obj.blueprint[i + 1].pos.x + nodeSize.x * 0.5f, canvasPos.y + obj.blueprint[i + 1].pos.y };
            dl->AddLine(a, b, IM_COL32(230, 230, 230, 210), 2.5f);
            ImVec2 mid = { (a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f };
            dl->AddTriangleFilled(ImVec2(mid.x - 5, mid.y - 5), ImVec2(mid.x + 5, mid.y - 5), ImVec2(mid.x, mid.y + 6), IM_COL32(230, 230, 230, 230));
        }

        int deleteIndex = -1;
        for (int i = 0; i < (int)obj.blueprint.size(); i++) {
            BlueprintNode& node = obj.blueprint[i];
            if (node.pos.x > canvasSize.x - nodeSize.x) node.pos.x = std::max(0.0f, canvasSize.x - nodeSize.x);
            if (node.pos.x < 0.0f) node.pos.x = 0.0f;
            if (node.pos.y < 0.0f) node.pos.y = 0.0f;

            ImVec2 boxMin = { canvasPos.x + node.pos.x, canvasPos.y + node.pos.y };
            ImVec2 boxMax = { boxMin.x + nodeSize.x, boxMin.y + nodeSize.y };
            const NodeTypeInfo& info = NODE_TYPES[node.type];

            dl->AddRectFilled(boxMin, boxMax, info.color, 6.0f);
            dl->AddRect(boxMin, boxMax, IM_COL32(0, 0, 0, 150), 6.0f, 0, 2.0f);
            dl->AddText(ImVec2(boxMin.x + 10, boxMin.y + 18), IM_COL32(25, 25, 25, 255), info.label);

            ImGui::PushID(i);
            ImGui::SetCursorScreenPos(boxMin);
            ImGui::InvisibleButton("##node", nodeSize);
            if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
                ImVec2 delta = ImGui::GetIO().MouseDelta;
                node.pos.x += delta.x;
                node.pos.y += delta.y;
            }
            ImGui::SetCursorScreenPos(ImVec2(boxMax.x - 22.0f, boxMin.y + 2.0f));
            if (ImGui::SmallButton("x")) deleteIndex = i;
            ImGui::PopID();
        }
        dl->PopClipRect();
        ImGui::SetCursorScreenPos(canvasPos);
        ImGui::Dummy(canvasSize);
        ImGui::EndChild();

        if (deleteIndex >= 0) obj.blueprint.erase(obj.blueprint.begin() + deleteIndex);

        ImGui::End();
    }

private:
    static constexpr float FOV_Y = 45.0f * 3.14159265f / 180.0f;

    std::unique_ptr<WEngine::Shader> m_Shader;
    std::unique_ptr<WEngine::Mesh> m_Cube;
    std::unique_ptr<WEngine::Mesh> m_Sphere;
    std::unique_ptr<WEngine::Mesh> m_Cylinder;
    std::unique_ptr<WEngine::Mesh> m_Grid;
    std::vector<SceneObject> m_Objects;
    std::unordered_map<std::string, std::unique_ptr<WEngine::Texture>> m_TextureCache;
    std::vector<std::string> m_AvailableTextures;
    int m_Selected = -1;
    int m_NextId = 5;
    int m_NewShape = Shape_Cube;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;
    WEngine::Mat4 m_LastViewProj;
    float m_ViewportW = 1.0f, m_ViewportH = 1.0f;

    bool m_PlayerMode = false;
    WEngine::Vec3 m_PlayerPos{ 0.0f, 1.0f, 6.0f };
    float m_PlayerVelY = 0.0f;
    bool m_PlayerGrounded = true;
    bool m_PlayerMoving = false;
    float m_PlayerFacingYaw = 0.0f;
    float m_WalkCycle = 0.0f;
    float m_SquashTimer = 0.0f;

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
