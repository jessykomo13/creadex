#include <Engine.h>
#include <vector>
#include <memory>
#include <string>
#include <unordered_map>
#include <cstdio>
#include <cstdlib>
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

// --- Blueprint : blocs visuels REELLEMENT executes en mode Jouer ------

enum NodeCategory { Cat_Event = 0, Cat_Condition = 1, Cat_Action = 2, Cat_Variable = 3 };
static const char* CATEGORY_NAMES[] = { "Evenements", "Conditions", "Actions", "Variables / Maths" };

// Ce qu'on peut regler sur un bloc (affiche dans "Details du bloc").
enum ParamKind {
    P_NONE = 0,
    P_AMOUNT,     // a : quantite (vies, force...)
    P_SECONDS,    // a : duree
    P_TEXT,       // sparam : texte libre
    P_KEY,        // sparam : une touche
    P_COLOR,      // vec : couleur
    P_VEC,        // vec : position / deplacement
    P_VAR_NUM,    // sparam + a : nom de variable et valeur
    P_VAR_RANGE,  // sparam + a + b : variable et intervalle
    P_THRESHOLD,  // a : seuil
};

enum NodeType {
    N_EVT_COLLISION = 0,
    N_ACT_LOSE_LIFE,
    N_ACT_KNOCKBACK,
    N_COND_LIFE_ZERO,
    N_ACT_RESTART,
    N_EVT_BEGIN,
    N_EVT_TICK,
    N_EVT_KEY,
    N_COND_LIFE_POS,
    N_COND_GROUNDED,
    N_COND_JUMPING,
    N_COND_VAR_EQ,
    N_COND_SPEED,
    N_ACT_GAIN_LIFE,
    N_ACT_TELEPORT,
    N_ACT_DESTROY,
    N_ACT_SPAWN,
    N_ACT_SOUND,
    N_ACT_COLOR,
    N_ACT_GRAVITY_ON,
    N_ACT_GRAVITY_OFF,
    N_ACT_FORCE,
    N_ACT_WAIT,
    N_ACT_MESSAGE,
    N_ACT_MOVE,
    N_ACT_CAM_ACTIVATE,
    N_ACT_CAM_FOLLOW,
    N_ACT_SET_TEXT,
    N_VAR_SET,
    N_MATH_ADD,
    N_MATH_SUB,
    N_MATH_RANDOM,
};

struct NodeTypeInfo {
    int category;
    const char* label;
    const char* shortLabel;
    ImU32 color;
    int param;
    const char* paramLabel;
};

// Couleurs a la Unreal : rouge = evenement, or = condition, bleu = action,
// vert = variable/maths. L'ordre doit suivre exactement l'enum NodeType.
static const NodeTypeInfo NODE_TYPES[] = {
    { Cat_Event,     "Evenement : Collision avec le Joueur", "Collision",   IM_COL32(205, 70, 70, 255),   P_NONE,      nullptr },
    { Cat_Action,    "Action : Enlever des vies",            "-Vie",        IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Vies enlevees" },
    { Cat_Action,    "Action : Repousser le joueur",         "Repousser",   IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Force" },
    { Cat_Condition, "Condition : Vie <= 0 ?",               "Vie<=0?",     IM_COL32(215, 185, 60, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Redemarrer le niveau",        "Redemarrer",  IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Event,     "Evenement : Debut du jeu",             "Debut jeu",   IM_COL32(205, 70, 70, 255),   P_NONE,      nullptr },
    { Cat_Event,     "Evenement : Chaque frame (Tick)",      "Tick",        IM_COL32(205, 70, 70, 255),   P_NONE,      nullptr },
    { Cat_Event,     "Evenement : Touche pressee",           "Touche",      IM_COL32(205, 70, 70, 255),   P_KEY,       "Touche" },
    { Cat_Condition, "Condition : Vie > 0 ?",                "Vie>0?",      IM_COL32(215, 185, 60, 255),  P_NONE,      nullptr },
    { Cat_Condition, "Condition : Est au sol ?",             "AuSol?",      IM_COL32(215, 185, 60, 255),  P_NONE,      nullptr },
    { Cat_Condition, "Condition : Est en train de sauter ?", "Saute?",      IM_COL32(215, 185, 60, 255),  P_NONE,      nullptr },
    { Cat_Condition, "Condition : Variable == valeur ?",     "Var==?",      IM_COL32(215, 185, 60, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Condition, "Condition : Vitesse verticale > ?",    "Vitesse>?",   IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Seuil" },
    { Cat_Action,    "Action : Ajouter des vies",            "+Vie",        IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Vies ajoutees" },
    { Cat_Action,    "Action : Teleporter le joueur",        "Teleporter",  IM_COL32(70, 130, 210, 255),  P_VEC,       "Destination" },
    { Cat_Action,    "Action : Detruire cet objet",          "Detruire",    IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Faire apparaitre un cube",    "Spawn",       IM_COL32(70, 130, 210, 255),  P_VEC,       "Decalage" },
    { Cat_Action,    "Action : Jouer un son",                "Son",         IM_COL32(70, 130, 210, 255),  P_TEXT,      "Nom du son" },
    { Cat_Action,    "Action : Changer la couleur",          "Couleur",     IM_COL32(70, 130, 210, 255),  P_COLOR,     "Couleur" },
    { Cat_Action,    "Action : Activer la gravite",          "Gravite ON",  IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Desactiver la gravite",       "Gravite OFF", IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Propulser le joueur",         "Force",       IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Force verticale" },
    { Cat_Action,    "Action : Attendre X secondes",         "Attendre",    IM_COL32(70, 130, 210, 255),  P_SECONDS,   "Secondes" },
    { Cat_Action,    "Action : Afficher un message",         "Message",     IM_COL32(70, 130, 210, 255),  P_TEXT,      "Message" },
    { Cat_Action,    "Action : Deplacer cet objet",          "Deplacer",    IM_COL32(70, 130, 210, 255),  P_VEC,       "Deplacement / seconde" },
    { Cat_Action,    "Action : Activer cette camera",        "Cam ON",      IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Camera suit le joueur",       "Cam suit",    IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Changer le texte",            "Texte",       IM_COL32(70, 130, 210, 255),  P_TEXT,      "Nouveau texte" },
    { Cat_Variable,  "Variable : Definir une variable",      "Def. var",    IM_COL32(80, 175, 100, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Variable,  "Maths : Ajouter a une variable",       "Var + N",     IM_COL32(80, 175, 100, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Variable,  "Maths : Soustraire a une variable",    "Var - N",     IM_COL32(80, 175, 100, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Variable,  "Maths : Nombre aleatoire",             "Aleatoire",   IM_COL32(80, 175, 100, 255),  P_VAR_RANGE, "Variable / min / max" },
};
static const int NODE_TYPE_COUNT = (int)(sizeof(NODE_TYPES) / sizeof(NODE_TYPES[0]));

struct BlueprintNode {
    int type = 0;
    ImVec2 pos{ 0.0f, 0.0f };
    float a = 1.0f;
    float b = 10.0f;
    std::string sparam;
    WEngine::Vec3 vec{ 1.0f, 1.0f, 1.0f };
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

    // Etat de jeu (remis a zero quand on arrete le jeu)
    bool destroyed = false;
    bool touching = false;
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

// Chaine de blocs mise en pause par un bloc "Attendre".
struct PendingChain {
    int objIndex = -1;
    int nodeIndex = 0;
    float delay = 0.0f;
};

struct HudMessage {
    std::string text;
    float timeLeft = 0.0f;
};

// Etat du jeu pendant le mode Jouer (remis a zero a chaque lancement).
struct PlayState {
    int life = 3;
    bool gravity = true;
    int activeCamera = -1; // index de l'objet Camera qui donne la vue, -1 = suit le joueur
    std::unordered_map<std::string, float> vars;
    std::vector<HudMessage> messages;
};

// Editeur complet : viewport libre, selection/gizmo, eclairage, textures,
// objets Camera/Texte, personnage jouable, et un Blueprint visuel dont les
// blocs sont reellement executes quand on lance le jeu.
class Scene3DLayer : public WEngine::Layer {
public:
    Scene3DLayer() : Layer("Scene3D") {
        m_Shader = std::make_unique<WEngine::Shader>(VERTEX_SRC, FRAGMENT_SRC);
        // Emplacements des uniformes recuperes une fois pour toutes : evite
        // des centaines d'allocations de std::string par frame dans le rendu.
        m_Shader->Bind();
        m_LocModel     = m_Shader->GetUniformLocation("u_Model");
        m_LocNormalMat = m_Shader->GetUniformLocation("u_NormalMatrix");
        m_LocTint      = m_Shader->GetUniformLocation("u_Tint");
        m_LocLit       = m_Shader->GetUniformLocation("u_Lit");
        m_LocUseTex    = m_Shader->GetUniformLocation("u_UseTexture");

        m_Cube.reset(WEngine::Mesh::CreateCube());
        m_Sphere.reset(WEngine::Mesh::CreateSphere());
        m_Cylinder.reset(WEngine::Mesh::CreateCylinder());
        m_Grid.reset(WEngine::Mesh::CreateGrid(10, 1.0f));

        auto addShape = [&](const char* name, WEngine::Vec3 pos, WEngine::Vec3 tint) -> SceneObject& {
            SceneObject o;
            o.name = name;
            o.position = pos;
            o.tint = tint;
            m_Objects.push_back(o);
            return m_Objects.back();
        };

        // Piege de demo : son blueprint est deja rempli et fonctionne des
        // qu'on lance le jeu (marche dessus pour perdre une vie).
        {
            SceneObject& trap = addShape("Piege rouge", { 0.0f, 0.5f, 0.0f }, { 0.85f, 0.25f, 0.25f });
            trap.blueprint = DefaultBlueprint(Shape_Cube);
        }
        addShape("Cube 2", { 2.5f, 0.5f, -1.5f }, { 0.35f, 0.65f, 0.9f });
        addShape("Cube 3", { -2.0f, 1.0f, 1.0f }, { 0.4f, 0.85f, 0.55f });
        addShape("Cube 4", { 1.0f, 1.5f, 3.0f }, { 0.95f, 0.75f, 0.25f });
        addShape("Cube 5", { -3.0f, 0.5f, -2.5f }, { 0.7f, 0.5f, 0.9f });

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
        camObj.position = { -7.0f, 4.0f, 8.0f };   // plan large sur la scene
        camObj.rotationEuler = { -20.0f, -49.0f, 0.0f };
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

    // --- Blueprints par defaut, adaptes au type d'objet ---------------
    // (une camera n'a rien a faire avec un piege : elle recoit une chaine
    // qui la rend reellement utile - elle devient la vue du jeu.)
    static std::vector<BlueprintNode> DefaultBlueprint(int shape) {
        std::vector<BlueprintNode> bp;
        auto add = [&](int type) -> BlueprintNode& {
            BlueprintNode n;
            n.type = type;
            n.pos = ImVec2(30.0f, 30.0f + (float)bp.size() * 96.0f);
            bp.push_back(n);
            return bp.back();
        };

        if (shape == Shape_Camera) {
            add(N_EVT_BEGIN);
            add(N_ACT_CAM_ACTIVATE);
            return bp;
        }
        if (shape == Shape_Text) {
            add(N_EVT_BEGIN);
            add(N_ACT_SET_TEXT).sparam = "Bienvenue !";
            return bp;
        }
        // Formes solides : le piege classique (collision -> degats -> reset)
        add(N_EVT_COLLISION);
        add(N_ACT_LOSE_LIFE).a = 1.0f;
        add(N_ACT_KNOCKBACK).a = 8.0f;
        add(N_ACT_MESSAGE).sparam = "Aie ! Piege touche";
        BlueprintNode& cond = add(N_COND_LIFE_ZERO);
        (void)cond;
        add(N_ACT_RESTART);
        return bp;
    }

    void OnUpdate(WEngine::Timestep ts) override {
        bool uiHasMouse = ImGui::GetIO().WantCaptureMouse;
        float dt = ts.GetSeconds();
        if (dt > 0.1f) dt = 0.1f; // evite un saut geant apres une pause

        if (m_PlayerMode) {
            UpdatePlayer(ts, uiHasMouse);
            RunBlueprints(dt);
        } else {
            if (!uiHasMouse) {
                m_Camera.OnUpdate(ts);
            }
            UpdatePickingAndGizmo(uiHasMouse);
        }

        m_Time += dt;
        m_LastFrameTime = dt;

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
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, 1.0f, 1.0f, 1.0f);
        SetModel(WEngine::Mat4::Identity());
        m_Grid->Draw();

        for (int i = 0; i < (int)m_Objects.size(); i++) {
            auto& obj = m_Objects[i];
            if (obj.destroyed) continue;
            if (obj.shape == Shape_Text) continue; // rendu en overlay 2D (OnImGuiRender)
            if (obj.shape == Shape_Camera) {
                // On ne dessine pas le marqueur de la camera qu'on regarde a
                // travers, sinon on se retrouve a l'interieur de sa geometrie.
                if (m_PlayerMode && i == m_Play.activeCamera) continue;
                DrawCameraMarker(obj, !m_PlayerMode && i == m_Selected);
                continue;
            }

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
            if (!m_PlayerMode && i == m_Selected) {
                tint = { Clamp01(tint.x * 1.25f), Clamp01(tint.y * 1.25f), Clamp01(tint.z * 1.25f) };
            }

            WEngine::Texture* tex = obj.texturePath.empty() ? nullptr : GetTexture(obj.texturePath);
            m_Shader->SetInt(m_LocLit, 1);
            if (tex) {
                tex->Bind(0);
                m_Shader->SetInt(m_LocUseTex, 1);
            } else {
                m_Shader->SetInt(m_LocUseTex, 0);
            }
            m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);
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
        m_Shader->SetMat4(m_LocModel, model.m);
        WEngine::Mat4 normalMat = model;
        normalMat.m[12] = 0.0f; normalMat.m[13] = 0.0f; normalMat.m[14] = 0.0f;
        m_Shader->SetMat4(m_LocNormalMat, normalMat.m);
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

        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);

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

    // ================= Moteur de Blueprint =============================

    void StartPlay() {
        m_SavedObjects = m_Objects;   // instantane : l'arret restaure tout
        m_Play = PlayState{};
        m_Pending.clear();

        for (auto& o : m_Objects) { o.destroyed = false; o.touching = false; }

        m_PlayerSpawn = m_Camera.Position + m_Camera.Forward() * 3.0f;
        m_PlayerSpawn.y = 1.0f;
        m_PlayerPos = m_PlayerSpawn;
        m_PlayerVelY = 0.0f;
        m_PlayerGrounded = true;
        m_PlayerMode = true;

        for (int i = 0; i < (int)m_Objects.size(); i++) FireEvent(i, N_EVT_BEGIN);
        ApplyDeferred();
    }

    void StopPlay() {
        m_Objects = m_SavedObjects;   // annule tout ce que les blueprints ont change
        m_SavedObjects.clear();
        m_Pending.clear();
        m_Play = PlayState{};
        m_PlayerMode = false;
        if (m_Selected >= (int)m_Objects.size()) m_Selected = -1;
        if (m_ScriptTarget >= (int)m_Objects.size()) { m_ScriptTarget = -1; m_ShowScriptEditor = false; }
    }

    void TogglePlay() {
        if (m_PlayerMode) StopPlay(); else StartPlay();
    }

    void AddMessage(const std::string& text) {
        m_Play.messages.push_back({ text, 4.0f });
        if (m_Play.messages.size() > 6) m_Play.messages.erase(m_Play.messages.begin());
    }

    bool PlayerTouches(const SceneObject& obj) const {
        if (obj.shape == Shape_Camera || obj.shape == Shape_Text) return false;
        // Marge un peu plus large que celle du blocage (CollidesAt), sinon le
        // joueur s'arrete pile au bord sans jamais "toucher" l'objet.
        const float TOUCH_MARGIN = 0.15f;
        float halfX = std::fabs(obj.scale.x) * 0.5f + PLAYER_RADIUS + TOUCH_MARGIN;
        float halfZ = std::fabs(obj.scale.z) * 0.5f + PLAYER_RADIUS + TOUCH_MARGIN;
        float minY = obj.position.y - std::fabs(obj.scale.y) * 0.5f - 0.2f;
        float maxY = obj.position.y + std::fabs(obj.scale.y) * 0.5f + 0.2f;
        float feet = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        float head = m_PlayerPos.y + PLAYER_HALF_HEIGHT;
        if (head < minY || feet > maxY) return false;
        return m_PlayerPos.x > obj.position.x - halfX && m_PlayerPos.x < obj.position.x + halfX &&
               m_PlayerPos.z > obj.position.z - halfZ && m_PlayerPos.z < obj.position.z + halfZ;
    }

    void RunBlueprints(float dt) {
        // 1. Chaines en attente (bloc "Attendre X secondes")
        for (int i = (int)m_Pending.size() - 1; i >= 0; i--) {
            m_Pending[i].delay -= dt;
            if (m_Pending[i].delay <= 0.0f) {
                PendingChain p = m_Pending[i];
                m_Pending.erase(m_Pending.begin() + i);
                if (p.objIndex >= 0 && p.objIndex < (int)m_Objects.size() && !m_Objects[p.objIndex].destroyed) {
                    RunChain(p.objIndex, p.nodeIndex);
                }
            }
        }

        // 2. Tick + collisions
        m_FrameDt = dt;
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (m_Objects[i].destroyed) continue;
            FireEvent(i, N_EVT_TICK);
        }
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (m_Objects[i].destroyed) continue;
            bool now = PlayerTouches(m_Objects[i]);
            bool before = m_Objects[i].touching;
            m_Objects[i].touching = now;
            if (now && !before) FireEvent(i, N_EVT_COLLISION);
        }

        ApplyDeferred();

        // 3. Messages du HUD qui s'effacent
        for (int i = (int)m_Play.messages.size() - 1; i >= 0; i--) {
            m_Play.messages[i].timeLeft -= dt;
            if (m_Play.messages[i].timeLeft <= 0.0f) m_Play.messages.erase(m_Play.messages.begin() + i);
        }

        // 4. La vue suit la camera active, sinon le personnage
        if (m_Play.activeCamera >= 0 && m_Play.activeCamera < (int)m_Objects.size()) {
            const SceneObject& cam = m_Objects[m_Play.activeCamera];
            if (cam.shape == Shape_Camera && !cam.destroyed) {
                m_Camera.Position = cam.position;
                m_Camera.Yaw = cam.rotationEuler.y;
                m_Camera.Pitch = cam.rotationEuler.x;
            } else {
                m_Play.activeCamera = -1;
            }
        }
    }

    // Les actions qui changent la liste d'objets sont differees pour ne pas
    // invalider les boucles d'evenements en cours.
    void ApplyDeferred() {
        if (!m_PendingSpawns.empty()) {
            // Garde-fou : un "Tick -> Spawn" ferait grossir la scene a l'infini
            // et donnerait l'impression que le moteur rame.
            for (auto& s : m_PendingSpawns) {
                if ((int)m_Objects.size() >= MAX_OBJECTS) {
                    AddMessage("Limite d'objets atteinte (" + std::to_string(MAX_OBJECTS) + ")");
                    break;
                }
                m_Objects.push_back(s);
            }
            m_PendingSpawns.clear();
        }
        if (m_RestartRequested) {
            m_RestartRequested = false;
            m_Objects = m_SavedObjects;
            for (auto& o : m_Objects) { o.destroyed = false; o.touching = false; }
            m_Pending.clear();
            m_Play.life = 3;
            m_Play.vars.clear();
            m_Play.activeCamera = -1;
            m_PlayerPos = m_PlayerSpawn;
            m_PlayerVelY = 0.0f;
            m_PlayerGrounded = true;
            AddMessage("Niveau redemarre");
            if (m_Selected >= (int)m_Objects.size()) m_Selected = -1;
            if (m_ScriptTarget >= (int)m_Objects.size()) { m_ScriptTarget = -1; m_ShowScriptEditor = false; }
        }
    }

    bool KeyMatches(const std::string& s, int keyCode) const {
        char c = s.empty() ? 'E' : (char)std::toupper((unsigned char)s[0]);
        if (c >= 'A' && c <= 'Z') return keyCode == (GLFW_KEY_A + (c - 'A'));
        if (c >= '0' && c <= '9') return keyCode == (GLFW_KEY_0 + (c - '0'));
        return false;
    }

    void FireEvent(int objIndex, int eventType, int keyCode = -1) {
        if (objIndex < 0 || objIndex >= (int)m_Objects.size()) return;
        // copie des indices d'abord : la chaine peut modifier la scene
        std::vector<int> starts;
        const auto& bp = m_Objects[objIndex].blueprint;
        for (int i = 0; i < (int)bp.size(); i++) {
            if (bp[i].type != eventType) continue;
            if (eventType == N_EVT_KEY && !KeyMatches(bp[i].sparam, keyCode)) continue;
            starts.push_back(i + 1);
        }
        for (int s : starts) RunChain(objIndex, s);
    }

    // Execute a partir d'un bloc jusqu'a : la fin, le prochain evenement,
    // une condition fausse, ou une attente.
    void RunChain(int objIndex, int start) {
        for (int i = start;; i++) {
            if (objIndex < 0 || objIndex >= (int)m_Objects.size()) return;
            if (m_Objects[objIndex].destroyed) return;
            if (i >= (int)m_Objects[objIndex].blueprint.size()) return;

            BlueprintNode node = m_Objects[objIndex].blueprint[i]; // copie : l'action peut modifier le vecteur
            if (node.type < 0 || node.type >= NODE_TYPE_COUNT) return;
            int cat = NODE_TYPES[node.type].category;

            if (cat == Cat_Event) return;               // debut d'une autre chaine
            if (cat == Cat_Condition) {
                if (!EvalCondition(node)) return;       // condition fausse : on arrete la
                continue;
            }
            if (node.type == N_ACT_WAIT) {
                // Garde-fou : "Tick -> Attendre" empilerait une chaine par frame.
                if ((int)m_Pending.size() < MAX_PENDING) {
                    m_Pending.push_back({ objIndex, i + 1, node.a > 0.0f ? node.a : 1.0f });
                }
                return;
            }
            if (!RunAction(objIndex, node)) return;
        }
    }

    bool EvalCondition(const BlueprintNode& node) {
        switch (node.type) {
            case N_COND_LIFE_ZERO: return m_Play.life <= 0;
            case N_COND_LIFE_POS:  return m_Play.life > 0;
            case N_COND_GROUNDED:  return m_PlayerGrounded;
            case N_COND_JUMPING:   return !m_PlayerGrounded && m_PlayerVelY > 0.0f;
            case N_COND_SPEED:     return std::fabs(m_PlayerVelY) > node.a;
            case N_COND_VAR_EQ: {
                auto it = m_Play.vars.find(node.sparam);
                float v = (it == m_Play.vars.end()) ? 0.0f : it->second;
                return std::fabs(v - node.a) < 0.0001f;
            }
            default: return true;
        }
    }

    // Renvoie false pour arreter la chaine (objet detruit, niveau relance...).
    bool RunAction(int objIndex, const BlueprintNode& node) {
        SceneObject& obj = m_Objects[objIndex];
        switch (node.type) {
            case N_ACT_LOSE_LIFE: {
                int amount = (int)(node.a > 0.0f ? node.a : 1.0f);
                m_Play.life -= amount;
                AddMessage("-" + std::to_string(amount) + " vie (reste " + std::to_string(m_Play.life) + ")");
                break;
            }
            case N_ACT_GAIN_LIFE: {
                int amount = (int)(node.a > 0.0f ? node.a : 1.0f);
                m_Play.life += amount;
                AddMessage("+" + std::to_string(amount) + " vie (total " + std::to_string(m_Play.life) + ")");
                break;
            }
            case N_ACT_KNOCKBACK: {
                float force = node.a > 0.0f ? node.a : 8.0f;
                m_PlayerVelY = force;
                m_PlayerGrounded = false;
                WEngine::Vec3 away = (m_PlayerPos - obj.position);
                away.y = 0.0f;
                away = away.Normalized();
                m_PlayerPos = m_PlayerPos + away * 0.8f;
                break;
            }
            case N_ACT_FORCE:
                m_PlayerVelY += node.a;
                m_PlayerGrounded = false;
                break;
            case N_ACT_TELEPORT:
                m_PlayerPos = node.vec;
                m_PlayerVelY = 0.0f;
                break;
            case N_ACT_RESTART:
                m_RestartRequested = true;
                return false;
            case N_ACT_DESTROY:
                obj.destroyed = true;
                if (m_Play.activeCamera == objIndex) m_Play.activeCamera = -1;
                return false;
            case N_ACT_SPAWN: {
                SceneObject s;
                s.name = "Spawn " + std::to_string(++m_NextId);
                s.position = obj.position + node.vec;
                s.tint = { 0.9f, 0.9f, 0.4f };
                m_PendingSpawns.push_back(s);
                break;
            }
            case N_ACT_SOUND:
                // Pas encore de moteur audio : on affiche la note a l'ecran.
                AddMessage("[son] " + (node.sparam.empty() ? std::string("bip") : node.sparam));
                break;
            case N_ACT_COLOR:
                obj.tint = node.vec;
                break;
            case N_ACT_GRAVITY_ON:  m_Play.gravity = true;  break;
            case N_ACT_GRAVITY_OFF: m_Play.gravity = false; break;
            case N_ACT_MESSAGE:
                AddMessage(node.sparam.empty() ? obj.name : node.sparam);
                break;
            case N_ACT_MOVE:
                obj.position = obj.position + node.vec * m_FrameDt;
                break;
            case N_ACT_CAM_ACTIVATE:
                if (obj.shape == Shape_Camera) {
                    m_Play.activeCamera = objIndex;
                    AddMessage("Vue : " + obj.name);
                } else {
                    AddMessage("\"Activer cette camera\" ne marche que sur un objet Camera");
                }
                break;
            case N_ACT_CAM_FOLLOW:
                m_Play.activeCamera = -1;
                AddMessage("Vue : le personnage");
                break;
            case N_ACT_SET_TEXT:
                obj.text = node.sparam.empty() ? obj.text : node.sparam;
                break;
            case N_VAR_SET:
                m_Play.vars[node.sparam] = node.a;
                break;
            case N_MATH_ADD:
                m_Play.vars[node.sparam] += node.a;
                break;
            case N_MATH_SUB:
                m_Play.vars[node.sparam] -= node.a;
                break;
            case N_MATH_RANDOM: {
                float lo = node.a, hi = node.b;
                if (hi < lo) std::swap(lo, hi);
                float t = (float)std::rand() / (float)RAND_MAX;
                m_Play.vars[node.sparam] = lo + t * (hi - lo);
                break;
            }
            default: break;
        }
        return true;
    }

    // ---- Personnage jouable : mouvement, saut, animation procedurale ----

    float SurfaceHeightAt(float x, float z, float refY) {
        float best = 0.0f; // sol de base (grille, y=0)
        for (auto& obj : m_Objects) {
            if (obj.destroyed) continue;
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

    static constexpr float PLAYER_RADIUS = 0.35f;
    static constexpr float PLAYER_HALF_HEIGHT = 1.0f;
    static constexpr int MAX_OBJECTS = 400;
    static constexpr int MAX_PENDING = 256;

    // Bloque le joueur devant les cotes des objets (au lieu de les
    // traverser) : ignore un objet si le joueur a deja les pieds au niveau
    // (ou au-dessus) de son sommet, pour pouvoir marcher dessus librement.
    bool CollidesAt(float x, float z, float centerY) {
        float feet = centerY - PLAYER_HALF_HEIGHT;
        float head = centerY + PLAYER_HALF_HEIGHT;
        for (auto& obj : m_Objects) {
            if (obj.destroyed) continue;
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text) continue;
            float halfX = std::fabs(obj.scale.x) * 0.5f + PLAYER_RADIUS;
            float halfZ = std::fabs(obj.scale.z) * 0.5f + PLAYER_RADIUS;
            float minY = obj.position.y - std::fabs(obj.scale.y) * 0.5f;
            float maxY = obj.position.y + std::fabs(obj.scale.y) * 0.5f;
            if (feet >= maxY - 0.1f) continue; // deja dessus (ou au-dessus) : pas de collision laterale
            if (head <= minY) continue;
            if (x > obj.position.x - halfX && x < obj.position.x + halfX &&
                z > obj.position.z - halfZ && z < obj.position.z + halfZ) {
                return true;
            }
        }
        return false;
    }

    void UpdatePlayer(WEngine::Timestep ts, bool uiHasMouse) {
        bool freeLook = (m_Play.activeCamera < 0); // une camera active pilote la vue
        if (!uiHasMouse && freeLook) {
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
            float newX = m_PlayerPos.x + move.x * speed;
            float newZ = m_PlayerPos.z + move.z * speed;
            if (!CollidesAt(newX, m_PlayerPos.z, m_PlayerPos.y)) m_PlayerPos.x = newX;
            if (!CollidesAt(m_PlayerPos.x, newZ, m_PlayerPos.y)) m_PlayerPos.z = newZ;
            m_PlayerFacingYaw = std::atan2(move.x, move.z);
            m_WalkCycle += ts.GetSeconds() * 10.0f;
        }

        constexpr float GRAVITY = 20.0f, JUMP_SPEED = 8.0f;
        bool wasGrounded = m_PlayerGrounded;
        if (!uiHasMouse && m_PlayerGrounded && WEngine::Input::IsKeyPressed(GLFW_KEY_SPACE)) {
            m_PlayerVelY = JUMP_SPEED;
            m_PlayerGrounded = false;
        }
        if (m_Play.gravity) {
            m_PlayerVelY -= GRAVITY * ts.GetSeconds();
        } else {
            m_PlayerVelY = 0.0f;
        }
        float feetBefore = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        m_PlayerPos.y += m_PlayerVelY * ts.GetSeconds();
        float feetAfter = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        float ground = SurfaceHeightAt(m_PlayerPos.x, m_PlayerPos.z, feetBefore);
        if (m_Play.gravity && feetAfter <= ground) {
            m_PlayerPos.y = ground + PLAYER_HALF_HEIGHT;
            m_PlayerVelY = 0.0f;
            m_PlayerGrounded = true;
        } else if (m_Play.gravity) {
            m_PlayerGrounded = false;
        }
        if (!wasGrounded && m_PlayerGrounded) m_SquashTimer = 0.15f;
        if (m_SquashTimer > 0.0f) {
            m_SquashTimer -= ts.GetSeconds();
            if (m_SquashTimer < 0.0f) m_SquashTimer = 0.0f;
        }

        if (freeLook) {
            WEngine::Vec3 camOffset = m_Camera.Forward() * -5.0f + WEngine::Vec3(0.0f, 2.0f, 0.0f);
            m_Camera.Position = m_PlayerPos + camOffset;
        }
    }

    void DrawPart(const WEngine::Mat4& base, WEngine::Vec3 localPos, WEngine::Vec3 scale, WEngine::Vec3 tint, WEngine::Mesh* mesh) {
        WEngine::Mat4 model = WEngine::Mat4::Multiply(base,
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(localPos), WEngine::Mat4::Scale(scale)));
        m_Shader->SetInt(m_LocLit, 1);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);
        SetModel(model);
        mesh->Draw();
    }

    void DrawLimb(const WEngine::Mat4& base, WEngine::Vec3 pivotLocal, float angleRad, float length, float thickness, WEngine::Vec3 tint) {
        WEngine::Mat4 model = WEngine::Mat4::Multiply(base,
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(pivotLocal),
            WEngine::Mat4::Multiply(WEngine::Mat4::RotateX(angleRad),
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate({ 0.0f, -length * 0.5f, 0.0f }), WEngine::Mat4::Scale({ thickness, length, thickness })))));
        m_Shader->SetInt(m_LocLit, 1);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);
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
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
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
        m_Shader->SetFloat3(m_LocTint, r, g, b);
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
            if (!leftDown || m_Selected < 0 || m_Selected >= (int)m_Objects.size()) {
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
            if (m_Objects[i].destroyed || m_Objects[i].shape == Shape_Text) continue;
            float t;
            if (WEngine::RaySphereIntersect(ray, m_Objects[i].position, m_Objects[i].pickRadius, t) && t < bestT) {
                bestT = t; bestObj = i;
            }
        }
        m_Selected = bestObj;
    }

    // ================= Interface ======================================

    void OnImGuiRender() override {
        DrawOutliner();
        DrawInspector();
        DrawTexturesPanel();

        if (m_ShowScriptEditor && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            DrawBlueprintEditor(m_Objects[m_ScriptTarget]);
        }

        DrawPlayPanel();
        DrawStatsPanel();
        DrawWorldOverlay();
    }

    void DrawOutliner() {
        ImGui::Begin("Outliner");
        ImGui::TextDisabled("%d objets", (int)m_Objects.size());
        ImGui::Separator();
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            bool selected = (m_Selected == i);
            std::string label = m_Objects[i].name;
            if (m_Objects[i].destroyed) label += "  (detruit)";
            if (!m_Objects[i].blueprint.empty()) label += "   [BP]";
            ImGui::PushID(i);
            if (ImGui::Selectable(label.c_str(), selected)) m_Selected = i;
            ImGui::PopID();
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
    }

    void DrawInspector() {
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
                ImGui::BeginDisabled(m_PlayerMode);
                if (ImGui::Button("Voir depuis cette camera", ImVec2(-1, 0))) {
                    m_Camera.Position = obj.position;
                    m_Camera.Yaw = obj.rotationEuler.y;
                    m_Camera.Pitch = obj.rotationEuler.x;
                }
                ImGui::EndDisabled();
                if (m_PlayerMode) {
                    ImGui::TextDisabled("En jeu : utilise le bloc \"Activer cette camera\".");
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
            std::string bpLabel = obj.blueprint.empty()
                ? "Blueprint visuel (N)"
                : "Blueprint visuel (N) - " + std::to_string(obj.blueprint.size()) + " blocs";
            if (ImGui::Button(bpLabel.c_str(), ImVec2(-1, 0))) {
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
    }

    void DrawTexturesPanel() {
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
    }

    void DrawPlayPanel() {
        ImGui::Begin("Jouer");
        ImVec4 col = m_PlayerMode ? ImVec4(0.75f, 0.2f, 0.2f, 1.0f) : ImVec4(0.2f, 0.65f, 0.25f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, col);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, col);
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, col);
        if (ImGui::Button(m_PlayerMode ? "Arreter (F5)" : "Lancer le jeu (F5)", ImVec2(-1, 44))) {
            TogglePlay();
        }
        ImGui::PopStyleColor(3);
        ImGui::Separator();

        if (m_PlayerMode) {
            ImGui::Text("Vie : %d", m_Play.life);
            ImGui::SameLine();
            ImGui::Text("| Gravite : %s", m_Play.gravity ? "ON" : "OFF");
            if (m_Play.activeCamera >= 0 && m_Play.activeCamera < (int)m_Objects.size()) {
                ImGui::Text("Vue : %s (bloc \"Activer cette camera\")", m_Objects[m_Play.activeCamera].name.c_str());
            } else {
                ImGui::Text("Vue : le personnage");
            }
            if (!m_Play.vars.empty()) {
                ImGui::Separator();
                ImGui::TextDisabled("Variables :");
                for (auto& kv : m_Play.vars) {
                    ImGui::Text("  %s = %.2f", kv.first.c_str(), kv.second);
                }
            }
            ImGui::Separator();
            ImGui::TextWrapped("WASD : marcher, Espace : sauter, clic droit + souris : orbiter la camera. Les blueprints des objets tournent pour de vrai.");
        } else {
            ImGui::TextWrapped("Lance le jeu pour executer les Blueprints des objets. Tout ce qu'ils changent (couleur, objets detruits, vies) est annule quand tu arretes.");
        }
        ImGui::End();
    }

    void DrawStatsPanel() {
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
        ImGui::End();
    }

    // Labels "Texte" du monde 3D + HUD du jeu, dessines par-dessus tout.
    void DrawWorldOverlay() {
        ImDrawList* fg = ImGui::GetForegroundDrawList();

        for (auto& obj : m_Objects) {
            if (obj.destroyed || obj.shape != Shape_Text) continue;
            ImVec2 screen;
            if (!WorldToScreen(obj.position, screen)) continue;
            float size = 18.0f * (obj.scale.x > 0.2f ? obj.scale.x : 1.0f);
            ImU32 col = IM_COL32((int)(Clamp01(obj.tint.x) * 255), (int)(Clamp01(obj.tint.y) * 255), (int)(Clamp01(obj.tint.z) * 255), 255);
            ImVec2 textSize = ImGui::CalcTextSize(obj.text.c_str());
            ImVec2 pos = { screen.x - textSize.x * 0.5f, screen.y };
            fg->AddText(nullptr, size, ImVec2(pos.x + 1, pos.y + 1), IM_COL32(0, 0, 0, 180), obj.text.c_str());
            fg->AddText(nullptr, size, pos, col, obj.text.c_str());
        }

        if (!m_PlayerMode) return;

        // HUD : vies + messages des blueprints
        float x = m_ViewportW * 0.5f - 60.0f, y = 24.0f;
        char lifeBuf[64];
        snprintf(lifeBuf, sizeof(lifeBuf), "Vie : %d", m_Play.life);
        fg->AddText(nullptr, 30.0f, ImVec2(x + 2, y + 2), IM_COL32(0, 0, 0, 200), lifeBuf);
        fg->AddText(nullptr, 30.0f, ImVec2(x, y),
            m_Play.life > 0 ? IM_COL32(255, 240, 120, 255) : IM_COL32(255, 90, 90, 255), lifeBuf);

        float my = y + 42.0f;
        for (auto& msg : m_Play.messages) {
            int alpha = (int)(255.0f * Clamp01(msg.timeLeft / 1.5f));
            fg->AddText(nullptr, 20.0f, ImVec2(x + 1, my + 1), IM_COL32(0, 0, 0, alpha), msg.text.c_str());
            fg->AddText(nullptr, 20.0f, ImVec2(x, my), IM_COL32(255, 255, 255, alpha), msg.text.c_str());
            my += 24.0f;
        }
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() != WEngine::EventType::KeyPressed) return;
        auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
        constexpr int KEY_ESCAPE = 256;
        constexpr int KEY_DELETE = 261;
        constexpr int KEY_N = 78;
        constexpr int KEY_F5 = 294;
        bool typing = ImGui::GetIO().WantTextInput;

        if (e.GetKeyCode() == KEY_ESCAPE) {
            WEngine::Application::Get().Close();
            return;
        }
        if (e.GetKeyCode() == KEY_F5 && !e.IsRepeat()) {
            TogglePlay();
            return;
        }
        if (typing || e.IsRepeat()) return;

        if (m_PlayerMode) {
            // Les blocs "Evenement : Touche pressee" recoivent la touche.
            for (int i = 0; i < (int)m_Objects.size(); i++) {
                if (m_Objects[i].destroyed) continue;
                FireEvent(i, N_EVT_KEY, e.GetKeyCode());
            }
            ApplyDeferred();
            return;
        }

        if (e.GetKeyCode() == KEY_N && m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            OpenBlueprintEditor(m_Selected);
        }
        if (e.GetKeyCode() == KEY_DELETE) {
            DeleteSelected();
        }
    }

    void DeleteSelected() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        m_Objects.erase(m_Objects.begin() + m_Selected);
        m_Selected = -1;
        m_ShowScriptEditor = false;
        m_ScriptTarget = -1;
    }

    void OpenBlueprintEditor(int index) {
        SceneObject& obj = m_Objects[index];
        if (obj.blueprint.empty()) {
            obj.blueprint = DefaultBlueprint(obj.shape);
        }
        m_ScriptTarget = index;
        m_ShowScriptEditor = true;
        m_SelectedNode = -1;
    }

    // Editeur de logique visuel a base de blocs : glisser-deposer, pas de
    // ligne de code. L'ordre des blocs = ordre d'execution (fleches).
    void DrawBlueprintEditor(SceneObject& obj) {
        std::string title = "Blueprint - " + obj.name;
        ImGui::SetNextWindowSize(ImVec2(620, 520), ImGuiCond_FirstUseEver);
        if (!ImGui::Begin(title.c_str(), &m_ShowScriptEditor)) { ImGui::End(); return; }

        ImGui::TextWrapped("Les blocs s'executent de haut en bas quand le jeu tourne. Clique un bloc pour regler ses details, glisse-le pour l'organiser.");
        ImGui::Separator();

        ImGui::SetNextItemWidth(170.0f);
        ImGui::Combo("##bpcat", &m_BpCategory, CATEGORY_NAMES, IM_ARRAYSIZE(CATEGORY_NAMES));
        ImGui::SameLine();

        std::vector<int> idxInCat;
        for (int t = 0; t < NODE_TYPE_COUNT; t++) {
            if (NODE_TYPES[t].category == m_BpCategory) idxInCat.push_back(t);
        }
        if (m_BpTypePick >= (int)idxInCat.size()) m_BpTypePick = 0;

        ImGui::SetNextItemWidth(280.0f);
        const char* previewLabel = idxInCat.empty() ? "-" : NODE_TYPES[idxInCat[m_BpTypePick]].label;
        if (ImGui::BeginCombo("##bptype", previewLabel)) {
            for (int k = 0; k < (int)idxInCat.size(); k++) {
                bool sel = (k == m_BpTypePick);
                if (ImGui::Selectable(NODE_TYPES[idxInCat[k]].label, sel)) m_BpTypePick = k;
            }
            ImGui::EndCombo();
        }
        ImGui::SameLine();
        if (ImGui::Button("+ Ajouter le bloc") && !idxInCat.empty()) {
            BlueprintNode n;
            n.type = idxInCat[m_BpTypePick];
            n.pos = ImVec2(30.0f, 30.0f + (float)obj.blueprint.size() * 96.0f);
            obj.blueprint.push_back(n);
            m_SelectedNode = (int)obj.blueprint.size() - 1;
        }
        ImGui::Separator();

        // Zone de details reservee en bas pour que le canvas ne saute pas.
        const float detailsHeight = 118.0f;
        ImVec2 avail = ImGui::GetContentRegionAvail();
        float canvasVisibleH = avail.y - detailsHeight;
        if (canvasVisibleH < 120.0f) canvasVisibleH = 120.0f;

        ImGui::BeginChild("##bp_canvas_child", ImVec2(0, canvasVisibleH), true, ImGuiWindowFlags_HorizontalScrollbar);

        const ImVec2 nodeSize(230.0f, 56.0f);
        float contentH = 30.0f;
        for (auto& n : obj.blueprint) contentH = std::max(contentH, n.pos.y + nodeSize.y + 20.0f);
        ImVec2 canvasSize = ImGui::GetContentRegionAvail();
        if (canvasSize.y < contentH) canvasSize.y = contentH;

        ImVec2 canvasPos = ImGui::GetCursorScreenPos();
        ImGui::InvisibleButton("##bp_canvas_bg", canvasSize);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 canvasEnd(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y);
        dl->PushClipRect(canvasPos, canvasEnd, true);
        dl->AddRectFilled(canvasPos, canvasEnd, IM_COL32(28, 28, 36, 255));
        // Grille en lignes (beaucoup moins de primitives qu'une grille de points).
        for (float gx = 0.0f; gx < canvasSize.x; gx += 48.0f)
            dl->AddLine(ImVec2(canvasPos.x + gx, canvasPos.y), ImVec2(canvasPos.x + gx, canvasEnd.y), IM_COL32(48, 48, 60, 255));
        for (float gy = 0.0f; gy < canvasSize.y; gy += 48.0f)
            dl->AddLine(ImVec2(canvasPos.x, canvasPos.y + gy), ImVec2(canvasEnd.x, canvasPos.y + gy), IM_COL32(48, 48, 60, 255));

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
            ImU32 border = (i == m_SelectedNode) ? IM_COL32(255, 255, 255, 255) : IM_COL32(0, 0, 0, 150);
            dl->AddRect(boxMin, boxMax, border, 6.0f, 0, (i == m_SelectedNode) ? 3.0f : 2.0f);
            dl->AddText(ImVec2(boxMin.x + 10, boxMin.y + 10), IM_COL32(25, 25, 25, 255), info.label);
            std::string sub = NodeSummary(node);
            if (!sub.empty()) {
                dl->AddText(ImVec2(boxMin.x + 10, boxMin.y + 32), IM_COL32(35, 35, 35, 210), sub.c_str());
            }

            ImGui::PushID(i);
            ImGui::SetCursorScreenPos(boxMin);
            ImGui::InvisibleButton("##node", nodeSize);
            if (ImGui::IsItemActivated()) m_SelectedNode = i;
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

        if (deleteIndex >= 0) {
            obj.blueprint.erase(obj.blueprint.begin() + deleteIndex);
            if (m_SelectedNode == deleteIndex) m_SelectedNode = -1;
            else if (m_SelectedNode > deleteIndex) m_SelectedNode--;
        }

        DrawNodeDetails(obj);
        ImGui::End();
    }

    // Petit resume affiche dans le bloc (2e ligne), facon Unreal.
    static std::string NodeSummary(const BlueprintNode& node) {
        char buf[96];
        switch (NODE_TYPES[node.type].param) {
            case P_AMOUNT:    snprintf(buf, sizeof(buf), "%.0f", node.a); return buf;
            case P_THRESHOLD: snprintf(buf, sizeof(buf), "> %.1f", node.a); return buf;
            case P_SECONDS:   snprintf(buf, sizeof(buf), "%.1f s", node.a); return buf;
            case P_KEY:       return "touche : " + (node.sparam.empty() ? std::string("E") : node.sparam);
            case P_TEXT:      return node.sparam;
            case P_VEC:       snprintf(buf, sizeof(buf), "%.1f, %.1f, %.1f", node.vec.x, node.vec.y, node.vec.z); return buf;
            case P_VAR_NUM:   snprintf(buf, sizeof(buf), "%s = %.1f", node.sparam.empty() ? "var" : node.sparam.c_str(), node.a); return buf;
            case P_VAR_RANGE: snprintf(buf, sizeof(buf), "%s : %.0f a %.0f", node.sparam.empty() ? "var" : node.sparam.c_str(), node.a, node.b); return buf;
            default: return std::string();
        }
    }

    void DrawNodeDetails(SceneObject& obj) {
        ImGui::Separator();
        if (m_SelectedNode < 0 || m_SelectedNode >= (int)obj.blueprint.size()) {
            ImGui::TextDisabled("Details du bloc : clique un bloc pour le regler.");
            return;
        }
        BlueprintNode& node = obj.blueprint[m_SelectedNode];
        const NodeTypeInfo& info = NODE_TYPES[node.type];
        ImGui::Text("Details : %s", info.label);

        switch (info.param) {
            case P_AMOUNT:
                ImGui::DragFloat(info.paramLabel, &node.a, 0.1f, 0.0f, 100.0f, "%.0f");
                break;
            case P_THRESHOLD:
                ImGui::DragFloat(info.paramLabel, &node.a, 0.1f, 0.0f, 100.0f, "%.1f");
                break;
            case P_SECONDS:
                ImGui::DragFloat(info.paramLabel, &node.a, 0.05f, 0.0f, 60.0f, "%.2f s");
                break;
            case P_TEXT:
            case P_KEY:
                ImGui::InputText(info.paramLabel, (char*)node.sparam.c_str(), node.sparam.capacity() + 1,
                    ImGuiInputTextFlags_CallbackResize, TextEditCallback, &node.sparam);
                break;
            case P_COLOR:
                ImGui::ColorEdit3(info.paramLabel, &node.vec.x);
                break;
            case P_VEC:
                ImGui::DragFloat3(info.paramLabel, &node.vec.x, 0.1f);
                break;
            case P_VAR_NUM:
                ImGui::InputText("Nom de la variable", (char*)node.sparam.c_str(), node.sparam.capacity() + 1,
                    ImGuiInputTextFlags_CallbackResize, TextEditCallback, &node.sparam);
                ImGui::DragFloat("Valeur", &node.a, 0.1f);
                break;
            case P_VAR_RANGE:
                ImGui::InputText("Nom de la variable", (char*)node.sparam.c_str(), node.sparam.capacity() + 1,
                    ImGuiInputTextFlags_CallbackResize, TextEditCallback, &node.sparam);
                ImGui::DragFloat("Minimum", &node.a, 0.1f);
                ImGui::DragFloat("Maximum", &node.b, 0.1f);
                break;
            default:
                ImGui::TextDisabled("Ce bloc n'a rien a regler.");
                break;
        }
    }

private:
    static constexpr float FOV_Y = 45.0f * 3.14159265f / 180.0f;

    std::unique_ptr<WEngine::Shader> m_Shader;
    int m_LocModel = -1, m_LocNormalMat = -1, m_LocTint = -1, m_LocLit = -1, m_LocUseTex = -1;
    std::unique_ptr<WEngine::Mesh> m_Cube;
    std::unique_ptr<WEngine::Mesh> m_Sphere;
    std::unique_ptr<WEngine::Mesh> m_Cylinder;
    std::unique_ptr<WEngine::Mesh> m_Grid;
    std::vector<SceneObject> m_Objects;
    std::vector<SceneObject> m_SavedObjects;   // instantane pris au lancement du jeu
    std::vector<SceneObject> m_PendingSpawns;
    std::unordered_map<std::string, std::unique_ptr<WEngine::Texture>> m_TextureCache;
    std::vector<std::string> m_AvailableTextures;
    int m_Selected = -1;
    int m_NextId = 5;
    int m_NewShape = Shape_Cube;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;
    float m_FrameDt = 0.0f;
    WEngine::Mat4 m_LastViewProj;
    float m_ViewportW = 1.0f, m_ViewportH = 1.0f;

    PlayState m_Play;
    std::vector<PendingChain> m_Pending;
    bool m_RestartRequested = false;

    bool m_PlayerMode = false;
    WEngine::Vec3 m_PlayerPos{ 0.0f, 1.0f, 6.0f };
    WEngine::Vec3 m_PlayerSpawn{ 0.0f, 1.0f, 6.0f };
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
    int m_SelectedNode = -1;
    int m_BpCategory = 0;
    int m_BpTypePick = 0;
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
