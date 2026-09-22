#include <Engine.h>
#include <vector>
#include <memory>
#include <string>
#include <unordered_map>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <sstream>
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

static const int MAX_POINT_LIGHTS = 8;

// Shader "materiau" facon Unreal : Metallic/Roughness (approximation
// Cook-Torrance simplifiee, sans carte d'environnement) + emissif, avec
// un soleil directionnel et jusqu'a 8 lumieres ponctuelles placables dans
// la scene (attenuation par distance/portee).
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
uniform vec3 u_LightColor;
uniform float u_Ambient;
uniform vec3 u_ViewPos;

uniform float u_Metallic;
uniform float u_Roughness;
uniform vec3 u_Emissive;

#define MAX_LIGHTS 8
uniform int u_PointLightCount;
uniform vec3 u_PointLightPos[MAX_LIGHTS];
uniform vec3 u_PointLightColor[MAX_LIGHTS];
uniform float u_PointLightIntensity[MAX_LIGHTS];
uniform float u_PointLightRadius[MAX_LIGHTS];

vec3 ShadeLight(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float metallic, float roughness) {
    vec3 H = normalize(V + L);
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    float shininess = mix(8.0, 256.0, 1.0 - clamp(roughness, 0.02, 1.0));
    float spec = pow(NdotH, shininess) * (shininess + 2.0) * 0.125;
    vec3 specular = F0 * spec;
    vec3 diffuse = albedo * (1.0 - metallic);
    return (diffuse + specular) * radiance * NdotL;
}

void main() {
    vec3 baseColor = (u_UseTexture != 0) ? texture(u_Texture, v_UV).rgb : v_Color;
    vec3 albedo = baseColor * u_Tint;

    if (u_Lit != 0) {
        vec3 N = normalize(v_Normal);
        vec3 V = normalize(u_ViewPos - v_WorldPos);

        vec3 result = albedo * u_Ambient;
        result += ShadeLight(N, V, normalize(-u_LightDir), u_LightColor, albedo, u_Metallic, u_Roughness);

        for (int i = 0; i < MAX_LIGHTS; i++) {
            if (i >= u_PointLightCount) break;
            vec3 toLight = u_PointLightPos[i] - v_WorldPos;
            float dist = length(toLight);
            vec3 Lp = toLight / max(dist, 0.0001);
            float atten = clamp(1.0 - dist / max(u_PointLightRadius[i], 0.001), 0.0, 1.0);
            atten = atten * atten;
            vec3 radiance = u_PointLightColor[i] * u_PointLightIntensity[i] * atten;
            result += ShadeLight(N, V, Lp, radiance, albedo, u_Metallic, u_Roughness);
        }

        result += u_Emissive;
        FragColor = vec4(result, 1.0);
    } else {
        FragColor = vec4(albedo, 1.0);
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
    N_ACT_ROTATE_OBJ,
    N_ACT_SCALE_OBJ,
    N_ACT_COLLISION_ON,
    N_ACT_COLLISION_OFF,
    N_ACT_DUPLICATE,
    N_ACT_LOOK_AT_PLAYER,
    N_ACT_CHASE_PLAYER,
    N_ACT_SET_PLAYER_SPEED,
    N_ACT_SET_GRAVITY,
    N_ACT_ADD_SCORE,
    N_ACT_WIN,
    N_ACT_RESET_PLAYER,
    N_COND_PLAYER_NEAR,
    N_COND_CHANCE,
    N_EVT_COLLISION_EXIT,
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
    { Cat_Action,    "Action : Faire tourner cet objet",     "Tourner",     IM_COL32(70, 130, 210, 255),  P_VEC,       "Degres par seconde" },
    { Cat_Action,    "Action : Changer l'echelle",           "Echelle",     IM_COL32(70, 130, 210, 255),  P_VEC,       "Nouvelle echelle" },
    { Cat_Action,    "Action : Activer la collision",        "Coll. ON",    IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Desactiver la collision",     "Coll. OFF",   IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Dupliquer cet objet",         "Dupliquer",   IM_COL32(70, 130, 210, 255),  P_VEC,       "Decalage de la copie" },
    { Cat_Action,    "Action : Se tourner vers le joueur",   "Regarder",    IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Avancer vers le joueur",      "Poursuivre",  IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Vitesse" },
    { Cat_Action,    "Action : Vitesse du joueur",           "Vit. joueur", IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Vitesse" },
    { Cat_Action,    "Action : Force de gravite",            "Gravite",     IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Force" },
    { Cat_Action,    "Action : Ajouter au score",            "+Score",      IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Points" },
    { Cat_Action,    "Action : Gagner le niveau",            "Gagner",      IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Renvoyer le joueur au depart", "Depart",     IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Condition, "Condition : Joueur proche ?",          "Proche?",     IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Distance" },
    { Cat_Condition, "Condition : Chance sur 100 ?",         "Chance?",     IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Pourcentage" },
    { Cat_Event,     "Evenement : Le joueur quitte l'objet", "Sortie",      IM_COL32(205, 70, 70, 255),   P_NONE,      nullptr },
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

static const char* SHAPE_NAMES[] = { "Cube", "Sphere", "Cylindre", "Camera", "Texte", "Modele 3D", "Lumiere" };
enum ShapeType { Shape_Cube = 0, Shape_Sphere = 1, Shape_Cylinder = 2, Shape_Camera = 3, Shape_Text = 4, Shape_Model = 5, Shape_Light = 6 };

struct SceneObject {
    std::string name;
    WEngine::Vec3 position;
    WEngine::Vec3 tint{ 1.0f, 1.0f, 1.0f }; // couleur ; pour une Lumiere : couleur de la lumiere
    float rotationSpeed = 0.0f;
    float pickRadius = 0.9f;
    std::vector<BlueprintNode> blueprint;
    int shape = Shape_Cube;
    WEngine::Vec3 rotationEuler{ 0.0f, 0.0f, 0.0f }; // degres ; pour une Camera : x=pitch, y=yaw
    WEngine::Vec3 scale{ 1.0f, 1.0f, 1.0f };
    std::string texturePath; // vide = pas de texture, couleur unie
    std::string modelPath;   // .obj importe (shape == Shape_Model)
    std::string text = "Texte"; // utilise seulement si shape == Shape_Text
    bool collision = true;   // l'objet bloque-t-il le joueur / sert-il de sol ?

    // Materiau (facon Unreal : Metallic/Roughness), pour les formes solides.
    float metallic = 0.0f;
    float roughness = 0.6f;
    WEngine::Vec3 emissive{ 0.0f, 0.0f, 0.0f };
    float emissiveStrength = 0.0f;

    // Lumiere ponctuelle (shape == Shape_Light)
    float lightIntensity = 3.0f;
    float lightRadius = 10.0f;

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
    int score = 0;
    float playerSpeed = 6.0f;
    float gravityForce = 20.0f;
    bool won = false;
    bool gravity = true;
    int activeCamera = -1;      // objet Camera qui donne la vue (-1 = vue par defaut)
    bool cameraFollows = false; // la camera active suit-elle le joueur ?
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
        m_Grid.reset(WEngine::Mesh::CreateGrid(20, 1.0f));
        m_Ring.reset(WEngine::Mesh::CreateRing(64));
        m_PreviewFB = std::make_unique<WEngine::Framebuffer>(384, 216);

        // Sol reel : avant, un plan invisible infini faisait "marcher sur
        // rien" au-dela de la grille. Maintenant le sol est un objet de la
        // scene, visible et limite : a cote, on tombe dans le vide.
        {
            SceneObject ground;
            ground.name = "Sol";
            ground.position = { 0.0f, -0.5f, 0.0f };
            ground.scale = { 40.0f, 1.0f, 40.0f };
            ground.tint = { 0.42f, 0.45f, 0.40f };
            ground.pickRadius = 2.5f;
            m_Objects.push_back(ground);
        }

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

        // Lumiere de demo : orange chaude au-dessus du piege, pour montrer
        // tout de suite l'effet d'une lumiere ponctuelle sur un materiau.
        SceneObject lightObj;
        lightObj.name = "Lumiere 1";
        lightObj.shape = Shape_Light;
        lightObj.position = { 0.0f, 2.5f, 1.5f };
        lightObj.tint = { 1.0f, 0.55f, 0.2f };
        lightObj.lightIntensity = 4.0f;
        lightObj.lightRadius = 9.0f;
        lightObj.collision = false;
        m_Objects.push_back(lightObj);

        RefreshContentList();
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
            add(N_ACT_CAM_FOLLOW); // sans ce bloc, la camera ne suit rien
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
        if (m_StatusTimer > 0.0f) m_StatusTimer -= dt;

        auto& window = WEngine::Application::Get().GetWindow();
        m_ViewportW = (float)window.GetWidth();
        m_ViewportH = (float)window.GetHeight();

        // 1) Apercu de la camera selectionnee, rendu hors-ecran (comme la
        //    petite fenetre d'apercu d'Unreal quand on selectionne une camera).
        m_PreviewValid = false;
        if (!m_PlayerMode && m_Selected >= 0 && m_Selected < (int)m_Objects.size()
            && m_Objects[m_Selected].shape == Shape_Camera && !m_Objects[m_Selected].destroyed) {
            const SceneObject& cam = m_Objects[m_Selected];
            WEngine::Camera previewCam;
            previewCam.Position = cam.position;
            previewCam.Yaw = cam.rotationEuler.y;
            previewCam.Pitch = cam.rotationEuler.x;

            float pAspect = (float)m_PreviewFB->GetWidth() / (float)m_PreviewFB->GetHeight();
            WEngine::Mat4 pProj = WEngine::Mat4::Perspective(FOV_Y, pAspect, 0.1f, 150.0f);
            WEngine::Mat4 pVP = WEngine::Mat4::Multiply(pProj, previewCam.GetViewMatrix());

            m_PreviewFB->Bind();
            WEngine::Renderer::SetClearColor(m_SkyColor.x, m_SkyColor.y, m_SkyColor.z, 1.0f);
            WEngine::Renderer::Clear();
            RenderScene(pVP, previewCam.Position, m_Selected, false);
            m_PreviewFB->Unbind((int)m_ViewportW, (int)m_ViewportH);
            m_PreviewValid = true;
        }

        // 2) Vue principale
        WEngine::Renderer::SetClearColor(m_SkyColor.x, m_SkyColor.y, m_SkyColor.z, 1.0f);
        WEngine::Renderer::Clear();

        float aspect = m_ViewportW / m_ViewportH;
        WEngine::Mat4 proj = WEngine::Mat4::Perspective(FOV_Y, aspect, 0.1f, 150.0f);
        m_LastViewProj = WEngine::Mat4::Multiply(proj, m_Camera.GetViewMatrix());

        int hiddenCamera = m_PlayerMode ? m_Play.activeCamera : -1;
        RenderScene(m_LastViewProj, m_Camera.Position, hiddenCamera, true);
    }

    // Dessine la scene depuis un point de vue donne. skipCamera : index d'un
    // objet Camera a ne pas dessiner (on est a l'interieur de son marqueur).
    void RenderScene(const WEngine::Mat4& viewProj, const WEngine::Vec3& viewPos, int skipCamera, bool withGizmoAndPlayer) {
        m_Shader->Bind();
        m_Shader->SetMat4("u_ViewProj", viewProj.m);
        m_Shader->SetFloat3("u_LightDir", m_LightDir.x, m_LightDir.y, m_LightDir.z);
        m_Shader->SetFloat3("u_LightColor", m_LightColor.x, m_LightColor.y, m_LightColor.z);
        m_Shader->SetFloat("u_Ambient", m_Ambient);
        m_Shader->SetFloat3("u_ViewPos", viewPos.x, viewPos.y, viewPos.z);
        m_Shader->SetInt("u_Texture", 0);

        // Lumieres ponctuelles placees dans la scene (jusqu'a MAX_POINT_LIGHTS).
        int lightCount = 0;
        for (const auto& obj : m_Objects) {
            if (obj.destroyed || obj.shape != Shape_Light) continue;
            if (lightCount >= MAX_POINT_LIGHTS) break;
            std::string idx = std::to_string(lightCount);
            m_Shader->SetFloat3(("u_PointLightPos[" + idx + "]").c_str(), obj.position.x, obj.position.y, obj.position.z);
            m_Shader->SetFloat3(("u_PointLightColor[" + idx + "]").c_str(), obj.tint.x, obj.tint.y, obj.tint.z);
            m_Shader->SetFloat(("u_PointLightIntensity[" + idx + "]").c_str(), obj.lightIntensity);
            m_Shader->SetFloat(("u_PointLightRadius[" + idx + "]").c_str(), obj.lightRadius);
            lightCount++;
        }
        m_Shader->SetInt("u_PointLightCount", lightCount);

        // Grille : non eclairee, couleur fixe.
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, 1.0f, 1.0f, 1.0f);
        m_Shader->SetFloat("u_Metallic", 0.0f);
        m_Shader->SetFloat("u_Roughness", 1.0f);
        m_Shader->SetFloat3("u_Emissive", 0.0f, 0.0f, 0.0f);
        SetModel(WEngine::Mat4::Identity());
        if (m_ShowGrid) m_Grid->Draw();

        if (m_ViewMode == 2) WEngine::Renderer::SetWireframe(true);
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            auto& obj = m_Objects[i];
            if (obj.destroyed) continue;
            if (obj.shape == Shape_Text) continue; // rendu en overlay 2D (OnImGuiRender)
            if (obj.shape == Shape_Camera) {
                if (i == skipCamera) continue;
                DrawCameraMarker(obj, !m_PlayerMode && i == m_Selected);
                continue;
            }
            if (obj.shape == Shape_Light) {
                DrawLightMarker(obj, !m_PlayerMode && i == m_Selected);
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
            m_Shader->SetInt(m_LocLit, m_ViewMode == 1 ? 0 : 1);
            if (tex) {
                tex->Bind(0);
                m_Shader->SetInt(m_LocUseTex, 1);
            } else {
                m_Shader->SetInt(m_LocUseTex, 0);
            }
            m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);
            m_Shader->SetFloat("u_Metallic", obj.metallic);
            m_Shader->SetFloat("u_Roughness", obj.roughness);
            m_Shader->SetFloat3("u_Emissive", obj.emissive.x * obj.emissiveStrength,
                obj.emissive.y * obj.emissiveStrength, obj.emissive.z * obj.emissiveStrength);
            SetModel(model);
            MeshFor(obj)->Draw();
        }

        if (m_PlayerMode) {
            DrawPlayer();
        }
        if (m_ViewMode == 2) WEngine::Renderer::SetWireframe(false);

        if (withGizmoAndPlayer && !m_PlayerMode && m_Selected >= 0 && m_Selected < (int)m_Objects.size()
            && m_Objects[m_Selected].shape != Shape_Text) {
            DrawGizmo(m_Objects[m_Selected]);
        }
    }

    // Petite ampoule non eclairee, coloree par la couleur de la lumiere,
    // avec un halo transparent pour donner une idee de sa portee.
    void DrawLightMarker(const SceneObject& obj, bool selected) {
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        WEngine::Vec3 tint = selected ? WEngine::Vec3(1.0f, 1.0f, 1.0f) : obj.tint;
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);
        WEngine::Mat4 bulb = WEngine::Mat4::Multiply(WEngine::Mat4::Translate(obj.position), WEngine::Mat4::Scale({ 0.3f, 0.3f, 0.3f }));
        SetModel(bulb);
        m_Sphere->Draw();
    }

    void SetModel(const WEngine::Mat4& model) {
        m_Shader->SetMat4(m_LocModel, model.m);
        WEngine::Mat4 normalMat = model;
        normalMat.m[12] = 0.0f; normalMat.m[13] = 0.0f; normalMat.m[14] = 0.0f;
        m_Shader->SetMat4(m_LocNormalMat, normalMat.m);
    }

    WEngine::Mesh* MeshFor(const SceneObject& obj) {
        if (obj.shape == Shape_Model && !obj.modelPath.empty()) {
            WEngine::Mesh* m = GetModel(obj.modelPath);
            if (m) return m;
        }
        if (obj.shape == Shape_Sphere) return m_Sphere.get();
        if (obj.shape == Shape_Cylinder) return m_Cylinder.get();
        return m_Cube.get();
    }

    // Modeles .obj importes (Blender), charges une fois puis reutilises.
    WEngine::Mesh* GetModel(const std::string& path) {
        auto it = m_ModelCache.find(path);
        if (it != m_ModelCache.end()) return it->second.get();
        std::unique_ptr<WEngine::Mesh> mesh(WEngine::Mesh::LoadOBJ(path));
        WEngine::Mesh* ptr = mesh.get();
        m_ModelCache[path] = std::move(mesh);
        return ptr;
    }

    WEngine::Texture* GetTexture(const std::string& path) {
        auto it = m_TextureCache.find(path);
        if (it != m_TextureCache.end()) return it->second->IsValid() ? it->second.get() : nullptr;
        auto tex = std::make_unique<WEngine::Texture>(path);
        WEngine::Texture* ptr = tex->IsValid() ? tex.get() : nullptr;
        m_TextureCache[path] = std::move(tex);
        return ptr;
    }

    void RefreshContentList() {
        m_AvailableTextures.clear();
        m_AvailableModels.clear();
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
            } else if (ext == ".obj") {
                m_AvailableModels.push_back(entry.path().string());
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


    // ================= Historique / presse-papier =====================

    void PushUndo() {
        m_UndoStack.push_back(m_Objects);
        if (m_UndoStack.size() > 64) m_UndoStack.erase(m_UndoStack.begin());
        m_RedoStack.clear();
    }

    void Undo() {
        if (m_UndoStack.empty()) { SetStatus("Rien a annuler"); return; }
        m_RedoStack.push_back(m_Objects);
        m_Objects = m_UndoStack.back();
        m_UndoStack.pop_back();
        ClampSelection();
        SetStatus("Annule");
    }

    void Redo() {
        if (m_RedoStack.empty()) { SetStatus("Rien a retablir"); return; }
        m_UndoStack.push_back(m_Objects);
        m_Objects = m_RedoStack.back();
        m_RedoStack.pop_back();
        ClampSelection();
        SetStatus("Retabli");
    }

    void ClampSelection() {
        if (m_Selected >= (int)m_Objects.size()) m_Selected = -1;
        if (m_ScriptTarget >= (int)m_Objects.size()) { m_ScriptTarget = -1; m_ShowScriptEditor = false; }
        m_DraggingAxis = -1;
    }

    void SetStatus(const std::string& msg) {
        m_StatusMessage = msg;
        m_StatusTimer = 3.0f;
    }

    void DuplicateSelected() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        PushUndo();
        SceneObject copy = m_Objects[m_Selected];
        copy.name += " (copie)";
        copy.position.x += 1.0f;
        m_Objects.push_back(copy);
        m_Selected = (int)m_Objects.size() - 1;
        SetStatus("Objet duplique");
    }

    void CopySelected() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        m_Clipboard.clear();
        m_Clipboard.push_back(m_Objects[m_Selected]);
        SetStatus("Copie");
    }

    void PasteClipboard() {
        if (m_Clipboard.empty()) { SetStatus("Presse-papier vide"); return; }
        PushUndo();
        for (auto& o : m_Clipboard) {
            SceneObject copy = o;
            copy.position.x += 1.0f;
            m_Objects.push_back(copy);
        }
        m_Selected = (int)m_Objects.size() - 1;
        SetStatus("Colle");
    }

    // Cadre la vue sur l'objet selectionne (touche F, comme dans Unreal).
    void FocusSelected() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        const SceneObject& o = m_Objects[m_Selected];
        float size = std::fmax(o.scale.x, std::fmax(o.scale.y, o.scale.z));
        float dist = 3.0f + size * 1.5f;
        m_Camera.Position = o.position - m_Camera.Forward() * dist;
        SetStatus("Vue centree sur " + o.name);
    }

    // ================= Sauvegarde / chargement de scene ================
    // Format texte simple, une cle par ligne : lisible et facile a relire.

    bool SaveScene(const std::string& path) {
        std::ofstream f(path);
        if (!f) { SetStatus("Impossible d'ecrire " + path); return false; }
        f << "WENGINE_SCENE 2\n";
        f << "sky " << m_SkyColor.x << " " << m_SkyColor.y << " " << m_SkyColor.z << "\n";
        f << "light " << m_LightDir.x << " " << m_LightDir.y << " " << m_LightDir.z << "\n";
        f << "lightcol " << m_LightColor.x << " " << m_LightColor.y << " " << m_LightColor.z << "\n";
        f << "ambient " << m_Ambient << "\n";
        for (const auto& o : m_Objects) {
            f << "OBJECT\n";
            f << "name " << o.name << "\n";
            f << "shape " << o.shape << "\n";
            f << "pos " << o.position.x << " " << o.position.y << " " << o.position.z << "\n";
            f << "rot " << o.rotationEuler.x << " " << o.rotationEuler.y << " " << o.rotationEuler.z << "\n";
            f << "scale " << o.scale.x << " " << o.scale.y << " " << o.scale.z << "\n";
            f << "tint " << o.tint.x << " " << o.tint.y << " " << o.tint.z << "\n";
            f << "rotspeed " << o.rotationSpeed << "\n";
            f << "collision " << (o.collision ? 1 : 0) << "\n";
            f << "texture " << o.texturePath << "\n";
            f << "model " << o.modelPath << "\n";
            f << "text " << o.text << "\n";
            f << "material " << o.metallic << " " << o.roughness << " " << o.emissiveStrength << "\n";
            f << "emissive " << o.emissive.x << " " << o.emissive.y << " " << o.emissive.z << "\n";
            f << "lightparams " << o.lightIntensity << " " << o.lightRadius << "\n";
            for (const auto& n : o.blueprint) {
                f << "node " << n.type << " " << n.pos.x << " " << n.pos.y << " "
                  << n.a << " " << n.b << " " << n.vec.x << " " << n.vec.y << " " << n.vec.z
                  << " " << n.sparam << "\n";
            }
            f << "ENDOBJECT\n";
        }
        SetStatus("Scene sauvegardee dans " + path);
        return true;
    }

    bool LoadScene(const std::string& path) {
        std::ifstream f(path);
        if (!f) { SetStatus("Fichier introuvable : " + path); return false; }

        std::vector<SceneObject> loaded;
        SceneObject cur;
        bool inObject = false;
        std::string line;
        while (std::getline(f, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line == "OBJECT") { cur = SceneObject{}; cur.blueprint.clear(); inObject = true; continue; }
            if (line == "ENDOBJECT") { if (inObject) loaded.push_back(cur); inObject = false; continue; }

            std::istringstream ss(line);
            std::string key;
            ss >> key;
            auto rest = [&]() { std::string r; std::getline(ss, r); if (!r.empty() && r[0] == ' ') r.erase(0, 1); return r; };

            if (!inObject) {
                if (key == "sky") ss >> m_SkyColor.x >> m_SkyColor.y >> m_SkyColor.z;
                else if (key == "light") ss >> m_LightDir.x >> m_LightDir.y >> m_LightDir.z;
                else if (key == "lightcol") ss >> m_LightColor.x >> m_LightColor.y >> m_LightColor.z;
                else if (key == "ambient") ss >> m_Ambient;
                continue;
            }

            if (key == "name") cur.name = rest();
            else if (key == "shape") ss >> cur.shape;
            else if (key == "pos") ss >> cur.position.x >> cur.position.y >> cur.position.z;
            else if (key == "rot") ss >> cur.rotationEuler.x >> cur.rotationEuler.y >> cur.rotationEuler.z;
            else if (key == "scale") ss >> cur.scale.x >> cur.scale.y >> cur.scale.z;
            else if (key == "tint") ss >> cur.tint.x >> cur.tint.y >> cur.tint.z;
            else if (key == "rotspeed") ss >> cur.rotationSpeed;
            else if (key == "collision") { int c = 1; ss >> c; cur.collision = (c != 0); }
            else if (key == "texture") cur.texturePath = rest();
            else if (key == "model") cur.modelPath = rest();
            else if (key == "text") cur.text = rest();
            else if (key == "material") ss >> cur.metallic >> cur.roughness >> cur.emissiveStrength;
            else if (key == "emissive") ss >> cur.emissive.x >> cur.emissive.y >> cur.emissive.z;
            else if (key == "lightparams") ss >> cur.lightIntensity >> cur.lightRadius;
            else if (key == "node") {
                BlueprintNode n;
                ss >> n.type >> n.pos.x >> n.pos.y >> n.a >> n.b >> n.vec.x >> n.vec.y >> n.vec.z;
                n.sparam = rest();
                if (n.type >= 0 && n.type < NODE_TYPE_COUNT) cur.blueprint.push_back(n);
            }
        }

        if (loaded.empty()) { SetStatus("Scene vide ou illisible : " + path); return false; }
        PushUndo();
        m_Objects = loaded;
        ClampSelection();
        m_Selected = -1;
        SetStatus("Scene chargee depuis " + path);
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
        if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light) return false;
        if (!obj.collision) return false;
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
            else if (!now && before) FireEvent(i, N_EVT_COLLISION_EXIT);
        }

        ApplyDeferred();

        // 3. Messages du HUD qui s'effacent
        for (int i = (int)m_Play.messages.size() - 1; i >= 0; i--) {
            m_Play.messages[i].timeLeft -= dt;
            if (m_Play.messages[i].timeLeft <= 0.0f) m_Play.messages.erase(m_Play.messages.begin() + i);
        }

        // 4. La vue vient de la camera activee par un blueprint, sinon de la
        //    vue par defaut derriere le personnage.
        if (m_Play.activeCamera >= 0 && m_Play.activeCamera < (int)m_Objects.size()) {
            SceneObject& cam = m_Objects[m_Play.activeCamera];
            if (cam.shape != Shape_Camera || cam.destroyed) {
                m_Play.activeCamera = -1;
            } else if (m_Play.cameraFollows) {
                // La camera se place derriere le joueur (l'objet Camera bouge
                // vraiment : on le voit dans l'Outliner et les Details).
                WEngine::Vec3 offset = m_Camera.Forward() * -5.0f + WEngine::Vec3(0.0f, 2.0f, 0.0f);
                cam.position = m_PlayerPos + offset;
                cam.rotationEuler.y = m_Camera.Yaw;
                cam.rotationEuler.x = m_Camera.Pitch;
                m_Camera.Position = cam.position;
            } else {
                m_Camera.Position = cam.position;
                m_Camera.Yaw = cam.rotationEuler.y;
                m_Camera.Pitch = cam.rotationEuler.x;
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
                m_CondObjectPos = m_Objects[objIndex].position;
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
            case N_COND_PLAYER_NEAR: {
                WEngine::Vec3 d = m_PlayerPos - m_CondObjectPos;
                float dist = std::sqrt(WEngine::Vec3::Dot(d, d));
                return dist < (node.a > 0.0f ? node.a : 5.0f);
            }
            case N_COND_CHANCE: {
                float roll = 100.0f * (float)std::rand() / (float)RAND_MAX;
                return roll < node.a;
            }
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
                    m_Play.cameraFollows = false; // camera fixe
                    AddMessage("Vue : " + obj.name + " (fixe)");
                } else {
                    AddMessage("\"Activer cette camera\" ne marche que sur un objet Camera");
                }
                break;
            case N_ACT_CAM_FOLLOW:
                // C'est CE bloc qui fait suivre le joueur : sans lui, une
                // camera ne suit rien.
                if (obj.shape == Shape_Camera) {
                    m_Play.activeCamera = objIndex;
                    m_Play.cameraFollows = true;
                    AddMessage("Vue : " + obj.name + " (suit le joueur)");
                } else {
                    AddMessage("\"Suivre le joueur\" ne marche que sur un objet Camera");
                }
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
            case N_ACT_ROTATE_OBJ:
                obj.rotationEuler = obj.rotationEuler + node.vec * m_FrameDt;
                break;
            case N_ACT_SCALE_OBJ: {
                WEngine::Vec3 sc = node.vec;
                if (sc.x < 0.05f) sc.x = 0.05f;
                if (sc.y < 0.05f) sc.y = 0.05f;
                if (sc.z < 0.05f) sc.z = 0.05f;
                obj.scale = sc;
                break;
            }
            case N_ACT_COLLISION_ON:  obj.collision = true;  break;
            case N_ACT_COLLISION_OFF: obj.collision = false; break;
            case N_ACT_DUPLICATE: {
                SceneObject copy = obj;
                copy.name = obj.name + " (copie)";
                copy.position = obj.position + node.vec;
                copy.blueprint.clear(); // evite une duplication en chaine infinie
                copy.touching = false;
                m_PendingSpawns.push_back(copy);
                break;
            }
            case N_ACT_LOOK_AT_PLAYER: {
                WEngine::Vec3 d = m_PlayerPos - obj.position;
                obj.rotationEuler.y = std::atan2(d.x, d.z) / DEG2RAD;
                break;
            }
            case N_ACT_CHASE_PLAYER: {
                WEngine::Vec3 d = m_PlayerPos - obj.position;
                d.y = 0.0f;
                d = d.Normalized();
                float sp = (node.a > 0.0f ? node.a : 2.0f) * m_FrameDt;
                obj.position = obj.position + d * sp;
                break;
            }
            case N_ACT_SET_PLAYER_SPEED:
                m_Play.playerSpeed = node.a > 0.0f ? node.a : 6.0f;
                AddMessage("Vitesse du joueur : " + std::to_string((int)m_Play.playerSpeed));
                break;
            case N_ACT_SET_GRAVITY:
                m_Play.gravityForce = node.a;
                AddMessage("Gravite : " + std::to_string((int)node.a));
                break;
            case N_ACT_ADD_SCORE: {
                int pts = (int)(node.a != 0.0f ? node.a : 1.0f);
                m_Play.score += pts;
                AddMessage("+" + std::to_string(pts) + " points (total " + std::to_string(m_Play.score) + ")");
                break;
            }
            case N_ACT_WIN:
                m_Play.won = true;
                AddMessage("NIVEAU TERMINE ! Score : " + std::to_string(m_Play.score));
                break;
            case N_ACT_RESET_PLAYER:
                m_PlayerPos = m_PlayerSpawn;
                m_PlayerVelY = 0.0f;
                m_PlayerVelXZ = { 0.0f, 0.0f, 0.0f };
                break;
            default: break;
        }
        return true;
    }

    // ---- Personnage jouable : mouvement, saut, animation procedurale ----

    // Plus de sol infini invisible : s'il n'y a aucun objet sous les pieds,
    // on tombe. Le sol de la scene est l'objet "Sol".
    static constexpr float VOID_Y = -1000.0f;

    float SurfaceHeightAt(float x, float z, float refY) {
        float best = VOID_Y;
        for (auto& obj : m_Objects) {
            if (obj.destroyed || !obj.collision) continue;
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light) continue;
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
            if (obj.destroyed || !obj.collision) continue;
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light) continue;
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
        bool freeLook = (m_Play.activeCamera < 0 || m_Play.cameraFollows);
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
        // --- Deplacement avec inertie (acceleration / friction / controle
        //     aerien / sprint), au lieu d'une vitesse constante ---
        float dt = ts.GetSeconds();
        bool sprint = WEngine::Input::IsKeyPressed(GLFW_KEY_LEFT_SHIFT);
        float maxSpeed = m_Play.playerSpeed * (sprint ? 1.7f : 1.0f);
        bool hasInput = (move.x != 0.0f || move.z != 0.0f);
        if (hasInput) move = move.Normalized();

        float accel = m_PlayerGrounded ? 50.0f : 50.0f * 0.4f;   // controle aerien reduit
        float friction = m_PlayerGrounded ? 12.0f : 1.2f;

        // friction
        float speed = std::sqrt(m_PlayerVelXZ.x * m_PlayerVelXZ.x + m_PlayerVelXZ.z * m_PlayerVelXZ.z);
        if (speed > 0.0001f) {
            float drop = speed * friction * dt;
            float newSpeed = speed - drop;
            if (newSpeed < 0.0f) newSpeed = 0.0f;
            m_PlayerVelXZ.x *= newSpeed / speed;
            m_PlayerVelXZ.z *= newSpeed / speed;
        }
        // acceleration
        if (hasInput) {
            m_PlayerVelXZ.x += move.x * accel * dt;
            m_PlayerVelXZ.z += move.z * accel * dt;
            float sp = std::sqrt(m_PlayerVelXZ.x * m_PlayerVelXZ.x + m_PlayerVelXZ.z * m_PlayerVelXZ.z);
            if (sp > maxSpeed) {
                m_PlayerVelXZ.x *= maxSpeed / sp;
                m_PlayerVelXZ.z *= maxSpeed / sp;
            }
        }

        float moveSpeed = std::sqrt(m_PlayerVelXZ.x * m_PlayerVelXZ.x + m_PlayerVelXZ.z * m_PlayerVelXZ.z);
        m_PlayerMoving = moveSpeed > 0.4f;
        if (moveSpeed > 0.0001f) {
            float newX = m_PlayerPos.x + m_PlayerVelXZ.x * dt;
            float newZ = m_PlayerPos.z + m_PlayerVelXZ.z * dt;
            if (!CollidesAt(newX, m_PlayerPos.z, m_PlayerPos.y)) m_PlayerPos.x = newX;
            else m_PlayerVelXZ.x = 0.0f;
            if (!CollidesAt(m_PlayerPos.x, newZ, m_PlayerPos.y)) m_PlayerPos.z = newZ;
            else m_PlayerVelXZ.z = 0.0f;
            m_PlayerFacingYaw = std::atan2(m_PlayerVelXZ.x, m_PlayerVelXZ.z);
            m_WalkCycle += dt * (4.0f + moveSpeed * 1.4f);
        }

        const float JUMP_SPEED = 8.0f;
        bool wasGrounded = m_PlayerGrounded;

        // Coyote time + memorisation du saut : le saut part meme si on
        // appuie un peu trop tot ou juste apres avoir quitte le sol.
        bool spaceDown = !uiHasMouse && WEngine::Input::IsKeyPressed(GLFW_KEY_SPACE);
        if (spaceDown && !m_SpaceWasDown) m_JumpBuffer = 0.12f;
        m_SpaceWasDown = spaceDown;
        m_CoyoteTimer = m_PlayerGrounded ? 0.12f : std::fmax(0.0f, m_CoyoteTimer - dt);
        m_JumpBuffer = std::fmax(0.0f, m_JumpBuffer - dt);
        if (m_JumpBuffer > 0.0f && m_CoyoteTimer > 0.0f) {
            m_PlayerVelY = JUMP_SPEED;
            m_PlayerGrounded = false;
            m_JumpBuffer = 0.0f;
            m_CoyoteTimer = 0.0f;
        }

        if (m_Play.gravity) {
            m_PlayerVelY -= m_Play.gravityForce * dt;
        } else {
            m_PlayerVelY = 0.0f;
        }
        float feetBefore = m_PlayerPos.y - PLAYER_HALF_HEIGHT;
        m_PlayerPos.y += m_PlayerVelY * dt;
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

        // Tombe hors du monde : on perd une vie et on revient au depart.
        if (m_PlayerPos.y < -15.0f) {
            m_Play.life -= 1;
            AddMessage("Tombe dans le vide ! (vie : " + std::to_string(m_Play.life) + ")");
            m_PlayerPos = m_PlayerSpawn;
            m_PlayerVelY = 0.0f;
            m_PlayerGrounded = true;
            if (m_Play.life <= 0) m_RestartRequested = true;
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

    void DrawGizmo(const SceneObject& obj) {
        const WEngine::Vec3& pos = obj.position;
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);

        if (m_GizmoMode == 1) {
            // Rotation : trois anneaux, un par axe
            DrawRotationRing(pos, 0, 0.95f, 0.25f, 0.25f);
            DrawRotationRing(pos, 1, 0.25f, 0.95f, 0.3f);
            DrawRotationRing(pos, 2, 0.3f, 0.45f, 0.95f);
            return;
        }

        bool scaleMode = (m_GizmoMode == 2);
        DrawAxisHandle(pos, AXIS_X, 0.95f, 0.25f, 0.25f, scaleMode);
        DrawAxisHandle(pos, AXIS_Y, 0.25f, 0.95f, 0.3f, scaleMode);
        DrawAxisHandle(pos, AXIS_Z, 0.3f, 0.45f, 0.95f, scaleMode);
    }

    void DrawRotationRing(const WEngine::Vec3& center, int axis, float r, float g, float b) {
        // L'anneau est cree dans le plan XZ : on le bascule selon l'axe.
        WEngine::Mat4 orient = WEngine::Mat4::Identity();
        if (axis == 0) orient = WEngine::Mat4::RotateZ(90.0f * DEG2RAD); // autour de X
        else if (axis == 2) orient = WEngine::Mat4::RotateX(90.0f * DEG2RAD); // autour de Z
        WEngine::Mat4 model = WEngine::Mat4::Multiply(
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(center), orient),
            WEngine::Mat4::Scale({ GIZMO_LEN, GIZMO_LEN, GIZMO_LEN }));
        m_Shader->SetFloat3(m_LocTint, r, g, b);
        SetModel(model);
        m_Ring->Draw();
    }

    void DrawAxisHandle(const WEngine::Vec3& origin, const WEngine::Vec3& axis, float r, float g, float b, bool boxTip) {
        float shaftLen = GIZMO_LEN * 0.7f, thick = 0.06f;
        float headLen = boxTip ? 0.22f : GIZMO_LEN * 0.3f;
        float headThick = boxTip ? 0.22f : 0.16f;

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
                SceneObject& sel = m_Objects[m_Selected];
                WEngine::Vec3 axis = m_DraggingAxis == 0 ? AXIS_X : (m_DraggingAxis == 1 ? AXIS_Y : AXIS_Z);

                if (m_GizmoMode == 1) {
                    // Rotation : le deplacement horizontal de la souris tourne l'objet
                    float delta = (mx - m_DragStartMouseX) * 0.5f;
                    if (m_Snap && m_SnapRot > 0.0f) delta = std::round(delta / m_SnapRot) * m_SnapRot;
                    WEngine::Vec3 rot = m_DragStartRot;
                    if (m_DraggingAxis == 0) rot.x += delta;
                    else if (m_DraggingAxis == 1) rot.y += delta;
                    else rot.z += delta;
                    sel.rotationEuler = rot;
                } else if (m_GizmoMode == 2) {
                    // Echelle : projection sur l'axe comme pour le deplacement
                    WEngine::Vec3 camFwd = m_Camera.Forward();
                    WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
                    WEngine::Vec3 hit;
                    if (WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) {
                        float t = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis) - m_DragStartOffset;
                        WEngine::Vec3 sc = m_DragStartScale;
                        float& target = (m_DraggingAxis == 0) ? sc.x : (m_DraggingAxis == 1 ? sc.y : sc.z);
                        target += t;
                        if (m_Snap && m_SnapScale > 0.0f) target = std::round(target / m_SnapScale) * m_SnapScale;
                        if (target < 0.05f) target = 0.05f;
                        sel.scale = sc;
                    }
                } else {
                    WEngine::Vec3 camFwd = m_Camera.Forward();
                    WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
                    WEngine::Vec3 hit;
                    if (WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) {
                        float t = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis);
                        WEngine::Vec3 p = m_DragOriginPos + axis * (t - m_DragStartOffset);
                        if (m_Snap && m_SnapMove > 0.0f) {
                            p.x = std::round(p.x / m_SnapMove) * m_SnapMove;
                            p.y = std::round(p.y / m_SnapMove) * m_SnapMove;
                            p.z = std::round(p.z / m_SnapMove) * m_SnapMove;
                        }
                        sel.position = p;
                    }
                }
            }
            return;
        }

        if (!justPressed) return;

        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            const SceneObject& sel = m_Objects[m_Selected];
            const WEngine::Vec3& objPos = sel.position;
            int bestAxis = -1;

            if (m_GizmoMode == 1) {
                // Anneaux : on croise le rayon avec le plan de chaque anneau
                // et on regarde si le point tombe pres du cercle.
                float bestDist = 1e9f;
                for (int a = 0; a < 3; a++) {
                    WEngine::Vec3 normal = (a == 0) ? AXIS_X : (a == 1 ? AXIS_Y : AXIS_Z);
                    WEngine::Vec3 hit;
                    if (!WEngine::RayPlaneIntersect(ray, objPos, normal, hit)) continue;
                    WEngine::Vec3 d = hit - objPos;
                    float radius = std::sqrt(WEngine::Vec3::Dot(d, d));
                    float diff = std::fabs(radius - GIZMO_LEN);
                    if (diff < 0.25f && diff < bestDist) { bestDist = diff; bestAxis = a; }
                }
            } else {
                float bestT = 1e9f;
                struct { int axis; WEngine::Vec3 dir; } handles[3] = { {0, AXIS_X}, {1, AXIS_Y}, {2, AXIS_Z} };
                for (auto& h : handles) {
                    WEngine::Vec3 handleCenter = objPos + h.dir * (GIZMO_LEN * 0.75f);
                    float t;
                    if (WEngine::RaySphereIntersect(ray, handleCenter, GIZMO_HANDLE_RADIUS, t) && t < bestT) {
                        bestT = t; bestAxis = h.axis;
                    }
                }
            }

            if (bestAxis >= 0) {
                PushUndo();
                m_DraggingAxis = bestAxis;
                m_DragOriginPos = objPos;
                m_DragStartScale = sel.scale;
                m_DragStartRot = sel.rotationEuler;
                m_DragStartMouseX = mx;
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
        DrawToolbar();
        DrawOutliner();
        DrawDetails();
        DrawContentBrowser();
        DrawWorldSettings();

        if (m_ShowScriptEditor && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            DrawBlueprintEditor(m_Objects[m_ScriptTarget]);
        }

        DrawStatsPanel();
        DrawWorldOverlay();
    }

    // Barre d'outils en haut, comme dans Unreal : le bouton Jouer y vit.
    void DrawToolbar() {
        ImGui::Begin("Barre d'outils");
        ImVec4 col = m_PlayerMode ? ImVec4(0.72f, 0.18f, 0.18f, 1.0f) : ImVec4(0.14f, 0.52f, 0.20f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, col);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(col.x * 1.25f, col.y * 1.25f, col.z * 1.25f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, col);
        if (ImGui::Button(m_PlayerMode ? "Arreter  (F5)" : "Jouer  (F5)", ImVec2(130, 28))) TogglePlay();
        ImGui::PopStyleColor(3);

        ImGui::SameLine();
        ImGui::TextDisabled("|");
        ImGui::SameLine();

        // Outils de transformation (W / E / R comme dans Unreal)
        const char* toolNames[3] = { "Deplacer (W)", "Tourner (E)", "Redim. (R)" };
        for (int i = 0; i < 3; i++) {
            if (i > 0) ImGui::SameLine();
            bool active = (m_GizmoMode == i);
            if (active) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.44f, 0.88f, 1.0f));
            if (ImGui::Button(toolNames[i], ImVec2(105, 28))) m_GizmoMode = i;
            if (active) ImGui::PopStyleColor();
        }

        ImGui::SameLine();
        ImGui::Checkbox("Magnetisme", &m_Snap);
        if (m_Snap) {
            ImGui::SameLine();
            ImGui::SetNextItemWidth(70);
            if (m_GizmoMode == 0) ImGui::DragFloat("##snap", &m_SnapMove, 0.05f, 0.05f, 10.0f, "%.2f u");
            else if (m_GizmoMode == 1) ImGui::DragFloat("##snap", &m_SnapRot, 1.0f, 1.0f, 90.0f, "%.0f deg");
            else ImGui::DragFloat("##snap", &m_SnapScale, 0.05f, 0.05f, 5.0f, "%.2f");
        }

        ImGui::SameLine();
        ImGui::TextDisabled("|");
        ImGui::SameLine();
        ImGui::SetNextItemWidth(130);
        const char* viewModes[] = { "Eclaire", "Non eclaire", "Fil de fer" };
        ImGui::Combo("##viewmode", &m_ViewMode, viewModes, IM_ARRAYSIZE(viewModes));

        ImGui::SameLine();
        if (ImGui::Button("Sauvegarder (Ctrl+S)", ImVec2(160, 28))) SaveScene(m_ScenePath);
        ImGui::SameLine();
        if (ImGui::Button("Charger (Ctrl+O)", ImVec2(140, 28))) LoadScene(m_ScenePath);

        ImGui::SameLine();
        ImGui::TextDisabled("|");
        ImGui::SameLine();
        ImGui::AlignTextToFramePadding();
        if (m_PlayerMode) {
            ImGui::Text("Vie : %d  |  Score : %d  |  Vue : %s",
                m_Play.life, m_Play.score,
                (m_Play.activeCamera >= 0 && m_Play.activeCamera < (int)m_Objects.size())
                    ? m_Objects[m_Play.activeCamera].name.c_str() : "par defaut");
        } else if (m_StatusTimer > 0.0f) {
            ImGui::TextColored(ImVec4(0.4f, 0.8f, 1.0f, 1.0f), "%s", m_StatusMessage.c_str());
        } else {
            ImGui::TextDisabled("Ctrl+Z annuler, Ctrl+D dupliquer, F cadrer, clic droit + WASD naviguer");
        }
        ImGui::End();
    }

    static bool NameMatches(const std::string& name, const std::string& filter) {
        std::string a = name, b = filter;
        for (auto& c : a) c = (char)std::tolower((unsigned char)c);
        for (auto& c : b) c = (char)std::tolower((unsigned char)c);
        return a.find(b) != std::string::npos;
    }

    void DrawOutliner() {
        ImGui::Begin("Outliner");
        ImGui::SetNextItemWidth(-1);
        ImGui::InputTextWithHint("##filter", "Rechercher...", (char*)m_OutlinerFilter.c_str(),
            m_OutlinerFilter.capacity() + 1, ImGuiInputTextFlags_CallbackResize, TextEditCallback, &m_OutlinerFilter);
        ImGui::TextDisabled("%d objets", (int)m_Objects.size());
        ImGui::Separator();
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (!m_OutlinerFilter.empty() && !NameMatches(m_Objects[i].name, m_OutlinerFilter)) continue;
            bool selected = (m_Selected == i);
            std::string label = m_Objects[i].name;
            if (m_Objects[i].destroyed) label += "  (detruit)";
            if (!m_Objects[i].blueprint.empty()) label += "   [BP]";
            ImGui::PushID(i);
            if (ImGui::Selectable(label.c_str(), selected)) m_Selected = i;
            ImGui::PopID();
        }
        ImGui::Separator();
        ImGui::SetNextItemWidth(-90.0f);
        ImGui::Combo("##newshape", &m_NewShape, SHAPE_NAMES, IM_ARRAYSIZE(SHAPE_NAMES));
        ImGui::SameLine();
        if (ImGui::Button("+ Ajouter", ImVec2(-1, 0))) {
            PushUndo();
            WEngine::Vec3 spawnPos = m_Camera.Position + m_Camera.Forward() * 4.0f;
            SceneObject obj;
            obj.name = std::string(SHAPE_NAMES[m_NewShape]) + " " + std::to_string(++m_NextId);
            obj.position = spawnPos;
            obj.tint = { 0.8f, 0.8f, 0.8f };
            obj.shape = m_NewShape;
            if (m_NewShape == Shape_Text) obj.text = "Nouveau texte";
            if (m_NewShape == Shape_Camera || m_NewShape == Shape_Text || m_NewShape == Shape_Light) obj.collision = false;
            if (m_NewShape == Shape_Light) obj.tint = { 1.0f, 0.92f, 0.75f }; // blanc chaud par defaut
            m_Objects.push_back(obj);
            m_Selected = (int)m_Objects.size() - 1;
        }
        ImGui::End();
    }

    // Panneau Details organise en sections comme Unreal.
    void DrawDetails() {
        ImGui::Begin("Details");
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) {
            ImGui::TextDisabled("Selectionne un objet dans l'Outliner ou clique dessus dans la scene.");
            ImGui::End();
            return;
        }

        SceneObject& obj = m_Objects[m_Selected];
        ImGui::SetNextItemWidth(-60);
        ImGui::InputText("Nom", (char*)obj.name.c_str(), obj.name.capacity() + 1,
            ImGuiInputTextFlags_CallbackResize, TextEditCallback, &obj.name);
        ImGui::TextDisabled("Type : %s", SHAPE_NAMES[obj.shape]);
        ImGui::Separator();

        bool isSolid = (obj.shape == Shape_Cube || obj.shape == Shape_Sphere
                     || obj.shape == Shape_Cylinder || obj.shape == Shape_Model);

        if (ImGui::CollapsingHeader("Transformation", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::DragFloat3("Emplacement", &obj.position.x, 0.05f);
            if (obj.shape == Shape_Camera) {
                ImGui::DragFloat("Rotation X (pitch)", &obj.rotationEuler.x, 0.5f, -89.0f, 89.0f);
                ImGui::DragFloat("Rotation Y (yaw)", &obj.rotationEuler.y, 0.5f);
            } else if (obj.shape != Shape_Light) {
                ImGui::DragFloat3("Rotation", &obj.rotationEuler.x, 0.5f);
                ImGui::DragFloat3("Echelle", &obj.scale.x, 0.02f, 0.05f, 40.0f);
            }
        }

        if (obj.shape == Shape_Light) {
            if (ImGui::CollapsingHeader("Lumiere", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::ColorEdit3("Couleur", &obj.tint.x);
                ImGui::DragFloat("Intensite", &obj.lightIntensity, 0.05f, 0.0f, 50.0f);
                ImGui::DragFloat("Portee", &obj.lightRadius, 0.1f, 0.5f, 100.0f);
                ImGui::TextDisabled("Portee = distance a laquelle la lumiere s'eteint.");
            }
        }

        if (obj.shape == Shape_Camera) {
            if (ImGui::CollapsingHeader("Camera", ImGuiTreeNodeFlags_DefaultOpen)) {
                if (m_PreviewValid) {
                    ImGui::TextDisabled("Apercu de la camera :");
                    float w = ImGui::GetContentRegionAvail().x;
                    float h = w * (float)m_PreviewFB->GetHeight() / (float)m_PreviewFB->GetWidth();
                    ImGui::Image((ImTextureID)(intptr_t)m_PreviewFB->GetColorAttachment(),
                        ImVec2(w, h), ImVec2(0, 1), ImVec2(1, 0));
                }
                ImGui::BeginDisabled(m_PlayerMode);
                if (ImGui::Button("Placer la vue d'editeur ici", ImVec2(-1, 0))) {
                    m_Camera.Position = obj.position;
                    m_Camera.Yaw = obj.rotationEuler.y;
                    m_Camera.Pitch = obj.rotationEuler.x;
                }
                ImGui::EndDisabled();
                ImGui::TextWrapped("Pour que cette camera serve en jeu, son Blueprint doit contenir "
                                   "\"Suivre le joueur\" (camera qui suit) ou \"Activer cette camera\" (camera fixe).");
            }
        }

        if (isSolid) {
            if (ImGui::CollapsingHeader("Rendu", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::ColorEdit3("Couleur", &obj.tint.x);
                ImGui::DragFloat("Rotation auto", &obj.rotationSpeed, 0.02f, 0.0f, 5.0f);
                if (obj.shape == Shape_Model) {
                    if (obj.modelPath.empty()) {
                        ImGui::TextDisabled("Aucun modele (Navigateur de contenu > Modeles)");
                    } else {
                        ImGui::Text("Modele : %s", fs::path(obj.modelPath).filename().string().c_str());
                        if (ImGui::Button("Retirer le modele", ImVec2(-1, 0))) obj.modelPath.clear();
                    }
                }
                if (obj.texturePath.empty()) {
                    ImGui::TextDisabled("Aucune texture (Navigateur de contenu > Textures)");
                } else {
                    ImGui::Text("Texture : %s", fs::path(obj.texturePath).filename().string().c_str());
                    if (ImGui::Button("Retirer la texture", ImVec2(-1, 0))) obj.texturePath.clear();
                }
            }

            // Materiau facon Unreal : Metallic / Roughness / Emissif. Les
            // valeurs pilotent directement le shader (voir FRAGMENT_SRC).
            if (ImGui::CollapsingHeader("Materiau", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::SliderFloat("Metallique", &obj.metallic, 0.0f, 1.0f);
                ImGui::SliderFloat("Rugosite", &obj.roughness, 0.02f, 1.0f);
                ImGui::TextDisabled("Metallique 0 = plastique/bois, 1 = metal brut. Rugosite 0 = poli/miroir, 1 = mat.");
                ImGui::ColorEdit3("Couleur emissive", &obj.emissive.x);
                ImGui::DragFloat("Intensite emissive", &obj.emissiveStrength, 0.02f, 0.0f, 20.0f);
                if (ImGui::Button("Preset : Plastique", ImVec2(-1, 0))) { obj.metallic = 0.0f; obj.roughness = 0.55f; }
                if (ImGui::Button("Preset : Metal brosse", ImVec2(-1, 0))) { obj.metallic = 1.0f; obj.roughness = 0.4f; }
                if (ImGui::Button("Preset : Metal poli / miroir", ImVec2(-1, 0))) { obj.metallic = 1.0f; obj.roughness = 0.06f; }
                if (ImGui::Button("Preset : Neon (emissif)", ImVec2(-1, 0))) {
                    obj.metallic = 0.0f; obj.roughness = 0.6f;
                    obj.emissive = obj.tint; obj.emissiveStrength = 3.0f;
                }
            }

            if (ImGui::CollapsingHeader("Collision", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::Checkbox("Bloquer le joueur / servir de sol", &obj.collision);
                if (!obj.collision) ImGui::TextDisabled("Le joueur passe au travers de cet objet.");
            }
        }

        if (obj.shape == Shape_Text) {
            if (ImGui::CollapsingHeader("Texte", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::InputText("Contenu", (char*)obj.text.c_str(), obj.text.capacity() + 1,
                    ImGuiInputTextFlags_CallbackResize, TextEditCallback, &obj.text);
                ImGui::ColorEdit3("Couleur", &obj.tint.x);
                ImGui::DragFloat("Taille", &obj.scale.x, 0.02f, 0.2f, 8.0f);
            }
        }

        if (ImGui::CollapsingHeader("Blueprint", ImGuiTreeNodeFlags_DefaultOpen)) {
            if (obj.blueprint.empty()) {
                ImGui::TextDisabled("Aucun blueprint sur cet objet.");
            } else {
                ImGui::Text("%d blocs", (int)obj.blueprint.size());
            }
            if (ImGui::Button("Ouvrir le Blueprint (N)", ImVec2(-1, 0))) {
                OpenBlueprintEditor(m_Selected);
            }
            if (!obj.blueprint.empty()) {
                if (ImGui::Button("Vider le Blueprint (tout supprimer)", ImVec2(-1, 0))) {
                    PushUndo();
                    obj.blueprint.clear();
                    m_SelectedNode = -1;
                    SetStatus("Blueprint vide");
                }
            }
        }

        ImGui::Separator();
        if (ImGui::Button("Supprimer (Suppr)", ImVec2(-1, 0))) {
            PushUndo();
            DeleteSelected();
        }
        ImGui::End();
    }

    void DrawContentBrowser() {
        ImGui::Begin("Navigateur de contenu");
        if (ImGui::Button("Rafraichir")) RefreshContentList();
        ImGui::SameLine();
        ImGui::TextDisabled("Depose tes fichiers dans le dossier \"assets\" a cote de l'executable "
                            "(.png/.jpg pour les textures, .obj exporte de Blender pour les modeles).");
        ImGui::Separator();

        if (ImGui::BeginTabBar("##content")) {
            if (ImGui::BeginTabItem("Textures")) {
                if (m_AvailableTextures.empty()) {
                    ImGui::TextDisabled("Aucune image dans /assets.");
                } else {
                    ImGui::TextDisabled("Clique une image pour l'appliquer a l'objet selectionne.");
                    for (auto& path : m_AvailableTextures) {
                        std::string label = fs::path(path).filename().string();
                        bool isCurrent = (m_Selected >= 0 && m_Selected < (int)m_Objects.size()
                                          && m_Objects[m_Selected].texturePath == path);
                        if (ImGui::Selectable(label.c_str(), isCurrent)) {
                            if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
                                SceneObject& obj = m_Objects[m_Selected];
                                if (obj.shape != Shape_Camera && obj.shape != Shape_Text) obj.texturePath = path;
                            }
                        }
                    }
                }
                ImGui::EndTabItem();
            }
            if (ImGui::BeginTabItem("Modeles 3D")) {
                if (m_AvailableModels.empty()) {
                    ImGui::TextDisabled("Aucun .obj dans /assets.");
                    ImGui::TextWrapped("Dans Blender : Fichier > Exporter > Wavefront (.obj), enregistre "
                                       "dans le dossier assets, puis Rafraichir.");
                } else {
                    ImGui::TextDisabled("Clique un modele pour l'appliquer a l'objet selectionne.");
                    for (auto& path : m_AvailableModels) {
                        std::string label = fs::path(path).filename().string();
                        bool isCurrent = (m_Selected >= 0 && m_Selected < (int)m_Objects.size()
                                          && m_Objects[m_Selected].modelPath == path);
                        if (ImGui::Selectable(label.c_str(), isCurrent)) {
                            if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
                                SceneObject& obj = m_Objects[m_Selected];
                                if (obj.shape != Shape_Camera && obj.shape != Shape_Text) {
                                    obj.modelPath = path;
                                    obj.shape = Shape_Model;
                                }
                            }
                        }
                    }
                }
                ImGui::EndTabItem();
            }
            ImGui::EndTabBar();
        }
        ImGui::End();
    }

    void DrawWorldSettings() {
        ImGui::Begin("Parametres du monde");
        if (ImGui::CollapsingHeader("Lumiere", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::DragFloat3("Direction", &m_LightDir.x, 0.02f, -1.0f, 1.0f);
            ImGui::ColorEdit3("Couleur", &m_LightColor.x);
            ImGui::SliderFloat("Lumiere ambiante", &m_Ambient, 0.0f, 1.0f);
        }
        if (ImGui::CollapsingHeader("Ciel", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::ColorEdit3("Couleur du ciel", &m_SkyColor.x);
        }
        if (ImGui::CollapsingHeader("Viewport", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::Checkbox("Afficher la grille", &m_ShowGrid);
            ImGui::DragFloat("Vitesse de la camera", &m_Camera.MoveSpeed, 0.2f, 0.5f, 60.0f);
        }
        if (ImGui::CollapsingHeader("Jeu", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::DragFloat("Vitesse du joueur", &m_Play.playerSpeed, 0.1f, 0.5f, 40.0f);
            ImGui::DragFloat("Force de gravite", &m_Play.gravityForce, 0.5f, 0.0f, 80.0f);
            ImGui::TextDisabled("Ces valeurs peuvent aussi etre changees par des blocs Blueprint.");
        }
        ImGui::End();
    }

    void DrawStatsPanel() {
        ImGui::Begin("Statistiques");
        ImGui::Text("FPS : %.0f", m_LastFrameTime > 0.0f ? 1.0f / m_LastFrameTime : 0.0f);
        ImGui::Text("Objets : %d", (int)m_Objects.size());
        ImGui::Text("Camera : %.1f, %.1f, %.1f", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        ImGui::Separator();
        ImGui::TextWrapped("Clic gauche sur un objet : le selectionner");
        ImGui::TextWrapped("Clic gauche + tirer une fleche du gizmo : le deplacer sur cet axe");
        ImGui::TextWrapped("Suppr : supprimer l'objet selectionne");
        ImGui::TextWrapped("N : ouvrir son Blueprint");
        ImGui::TextWrapped("F5 : lancer / arreter le jeu");
        ImGui::TextWrapped("Clic droit + souris : regarder, WASD : se deplacer, Q/E : monter/descendre, Shift : plus vite");
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

        if (m_Play.score != 0) {
            char scoreBuf[64];
            snprintf(scoreBuf, sizeof(scoreBuf), "Score : %d", m_Play.score);
            fg->AddText(nullptr, 22.0f, ImVec2(x + 2, y + 34), IM_COL32(0, 0, 0, 200), scoreBuf);
            fg->AddText(nullptr, 22.0f, ImVec2(x, y + 32), IM_COL32(180, 255, 180, 255), scoreBuf);
        }
        if (m_Play.won) {
            const char* wonText = "NIVEAU TERMINE !";
            ImVec2 sz = ImGui::CalcTextSize(wonText);
            float wx = m_ViewportW * 0.5f - sz.x * 1.2f;
            fg->AddText(nullptr, 44.0f, ImVec2(wx + 2, m_ViewportH * 0.35f + 2), IM_COL32(0, 0, 0, 220), wonText);
            fg->AddText(nullptr, 44.0f, ImVec2(wx, m_ViewportH * 0.35f), IM_COL32(120, 255, 140, 255), wonText);
        }

        float my = y + 66.0f;
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

        // --- Raccourcis d'editeur (memes touches que dans Unreal) ---
        constexpr int KEY_W = 87, KEY_E = 69, KEY_R = 82, KEY_F = 70;
        constexpr int KEY_Z = 90, KEY_Y = 89, KEY_D = 68, KEY_C = 67, KEY_V = 86;
        constexpr int KEY_S = 83, KEY_O = 79, KEY_LCTRL = 341, KEY_RCTRL = 345;
        bool ctrl = WEngine::Input::IsKeyPressed(KEY_LCTRL) || WEngine::Input::IsKeyPressed(KEY_RCTRL);
        int key = e.GetKeyCode();

        if (ctrl) {
            switch (key) {
                case KEY_Z: Undo(); return;
                case KEY_Y: Redo(); return;
                case KEY_D: DuplicateSelected(); return;
                case KEY_C: CopySelected(); return;
                case KEY_V: PasteClipboard(); return;
                case KEY_S: SaveScene(m_ScenePath); return;
                case KEY_O: LoadScene(m_ScenePath); return;
                default: break;
            }
        }

        // W/E/R changent d'outil (la navigation WASD demande le clic droit).
        if (!WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)) {
            if (key == KEY_W) { m_GizmoMode = 0; SetStatus("Outil : Deplacer"); return; }
            if (key == KEY_E) { m_GizmoMode = 1; SetStatus("Outil : Tourner"); return; }
            if (key == KEY_R) { m_GizmoMode = 2; SetStatus("Outil : Redimensionner"); return; }
        }
        if (key == KEY_F) { FocusSelected(); return; }

        if (key == KEY_N && m_Selected >= 0 && m_Selected < (int)m_Objects.size()) {
            OpenBlueprintEditor(m_Selected);
        }
        if (key == KEY_DELETE) {
            PushUndo();
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
        // On ne remplit plus automatiquement : chaque objet part d'un
        // blueprint vide, sinon tous les objets avaient le meme.
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
        if (ImGui::Button("Charger un exemple adapte a ce type d'objet")) {
            obj.blueprint = DefaultBlueprint(obj.shape);
            m_SelectedNode = -1;
        }
        if (obj.blueprint.empty()) {
            ImGui::TextDisabled("Blueprint vide : ajoute un bloc, ou clique \"Charger un exemple\" "
                                "pour partir d'une logique toute faite adaptee a ce type d'objet.");
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

            // Bouton "x" teste a la main (hors du systeme de widgets ImGui) :
            // le SmallButton dessine par-dessus l'InvisibleButton du bloc ne
            // recevait jamais le clic (probleme de resolution de survol par
            // superposition d'ImGui 1.93), donc on fait le hit-test nous-memes
            // et on desactive le glisser-deposer du bloc si la souris est dedans.
            ImVec2 delMin = ImVec2(boxMax.x - 22.0f, boxMin.y + 2.0f);
            ImVec2 delMax = ImVec2(boxMax.x - 2.0f, boxMin.y + 20.0f);
            bool overDelete = ImGui::IsMouseHoveringRect(delMin, delMax);

            ImGui::SetCursorScreenPos(boxMin);
            ImGui::InvisibleButton("##node", nodeSize);
            if (!overDelete) {
                if (ImGui::IsItemActivated()) m_SelectedNode = i;
                if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
                    ImVec2 delta = ImGui::GetIO().MouseDelta;
                    node.pos.x += delta.x;
                    node.pos.y += delta.y;
                }
            }

            ImU32 delCol = overDelete ? IM_COL32(230, 60, 60, 255) : IM_COL32(0, 0, 0, 130);
            dl->AddRectFilled(delMin, delMax, delCol, 3.0f);
            dl->AddText(ImVec2(delMin.x + 6.0f, delMin.y + 1.0f), IM_COL32(255, 255, 255, 255), "x");
            if (overDelete && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                deleteIndex = i;
                m_SelectedNode = -1;
            }
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
    std::unordered_map<std::string, std::unique_ptr<WEngine::Mesh>> m_ModelCache;
    std::vector<std::string> m_AvailableTextures;
    std::vector<std::string> m_AvailableModels;
    std::unique_ptr<WEngine::Framebuffer> m_PreviewFB;
    bool m_PreviewValid = false;
    int m_Selected = -1;
    int m_NextId = 5;
    int m_NewShape = Shape_Cube;
    WEngine::Camera m_Camera;
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;
    float m_FrameDt = 0.0f;
    WEngine::Mat4 m_LastViewProj;
    float m_ViewportW = 1.0f, m_ViewportH = 1.0f;

    // Parametres du monde (panneau dedie)
    WEngine::Vec3 m_LightDir{ -0.35f, -1.0f, -0.25f };
    WEngine::Vec3 m_LightColor{ 1.0f, 0.98f, 0.92f };
    float m_Ambient = 0.38f;
    WEngine::Vec3 m_SkyColor{ 0.45f, 0.6f, 0.78f };
    int m_ViewMode = 0;       // 0 Eclaire, 1 Non eclaire, 2 Fil de fer
    bool m_ShowGrid = true;

    // Gizmo : mode et magnetisme (comme W/E/R + Snap dans Unreal)
    int m_GizmoMode = 0;      // 0 Deplacer, 1 Tourner, 2 Redimensionner
    bool m_Snap = false;
    float m_SnapMove = 0.5f, m_SnapRot = 15.0f, m_SnapScale = 0.25f;
    WEngine::Vec3 m_DragStartScale{ 1.0f, 1.0f, 1.0f };
    WEngine::Vec3 m_DragStartRot{ 0.0f, 0.0f, 0.0f };
    float m_DragStartMouseX = 0.0f;

    // Historique (Ctrl+Z / Ctrl+Y) et presse-papier (Ctrl+C / Ctrl+V)
    std::vector<std::vector<SceneObject>> m_UndoStack, m_RedoStack;
    std::vector<SceneObject> m_Clipboard;
    std::string m_OutlinerFilter;
    std::string m_ScenePath = "scene.wscene";
    std::string m_StatusMessage;
    float m_StatusTimer = 0.0f;

    std::unique_ptr<WEngine::Mesh> m_Ring;

    PlayState m_Play;
    std::vector<PendingChain> m_Pending;
    bool m_RestartRequested = false;

    bool m_PlayerMode = false;
    WEngine::Vec3 m_PlayerPos{ 0.0f, 1.0f, 6.0f };
    WEngine::Vec3 m_PlayerSpawn{ 0.0f, 1.0f, 6.0f };
    WEngine::Vec3 m_PlayerVelXZ{ 0.0f, 0.0f, 0.0f };
    WEngine::Vec3 m_CondObjectPos{ 0.0f, 0.0f, 0.0f };
    float m_CoyoteTimer = 0.0f, m_JumpBuffer = 0.0f;
    bool m_SpaceWasDown = false;
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
