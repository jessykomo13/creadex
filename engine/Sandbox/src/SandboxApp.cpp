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
#include <cstring>

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
    P_VARNAME,    // sparam : juste un nom de variable (pas de valeur)
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

    // --- Lot supplementaire de blocs (conditions, actions, variables) ---
    N_COND_LIFE_LE,
    N_COND_LIFE_GE,
    N_COND_SCORE_GE,
    N_COND_SCORE_LE,
    N_COND_VAR_GT,
    N_COND_VAR_LT,
    N_COND_VAR_GE,
    N_COND_VAR_LE,
    N_COND_KEY_HELD,
    N_COND_MOVING,
    N_COND_TOUCHING_NOW,
    N_ACT_SET_LIFE,
    N_ACT_SET_SCORE,
    N_ACT_SUB_SCORE,
    N_ACT_RESET_SCORE,
    N_ACT_FULL_HEAL,
    N_ACT_HIDE_OBJECT,
    N_ACT_SHOW_OBJECT,
    N_ACT_TOGGLE_VISIBLE,
    N_ACT_FREEZE_PLAYER,
    N_ACT_UNFREEZE_PLAYER,
    N_ACT_SET_METALLIC,
    N_ACT_SET_ROUGHNESS,
    N_ACT_SET_EMISSIVE,
    N_ACT_SET_LIGHT_INTENSITY,
    N_ACT_SET_LIGHT_RANGE,
    N_MATH_MUL,
    N_MATH_DIV,
    N_VAR_FROM_LIFE,
    N_VAR_FROM_SCORE,
    N_VAR_FROM_DIST_PLAYER,
    N_ACT_TP_TO_PLAYER,
    N_ACT_TP_PLAYER_HERE,
    N_ACT_INVERT_GRAVITY,
    N_ACT_JUMP,
    N_ACT_STOP_PLAYER,
    N_ACT_PUSH_PLAYER,
    N_ACT_SET_POSITION,
    N_ACT_SET_ROTATION,
    N_ACT_SET_JUMP_FORCE,
    N_EVT_INTERVAL,
    N_ACT_SET_CHECKPOINT,
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

    // --- Lot supplementaire ---
    { Cat_Condition, "Condition : Vie <= valeur ?",          "Vie<=?",      IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Seuil" },
    { Cat_Condition, "Condition : Vie >= valeur ?",          "Vie>=?",      IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Seuil" },
    { Cat_Condition, "Condition : Score >= valeur ?",        "Score>=?",    IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Seuil" },
    { Cat_Condition, "Condition : Score <= valeur ?",        "Score<=?",    IM_COL32(215, 185, 60, 255),  P_THRESHOLD, "Seuil" },
    { Cat_Condition, "Condition : Variable > valeur ?",      "Var>?",       IM_COL32(215, 185, 60, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Condition, "Condition : Variable < valeur ?",      "Var<?",       IM_COL32(215, 185, 60, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Condition, "Condition : Variable >= valeur ?",     "Var>=?",      IM_COL32(215, 185, 60, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Condition, "Condition : Variable <= valeur ?",     "Var<=?",      IM_COL32(215, 185, 60, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Condition, "Condition : Touche maintenue ?",       "Maintenue?",  IM_COL32(215, 185, 60, 255),  P_KEY,       "Touche" },
    { Cat_Condition, "Condition : Le joueur bouge ?",        "Bouge?",      IM_COL32(215, 185, 60, 255),  P_NONE,      nullptr },
    { Cat_Condition, "Condition : Cet objet touche le joueur maintenant ?", "Touche?", IM_COL32(215, 185, 60, 255), P_NONE, nullptr },
    { Cat_Action,    "Action : Definir la vie",              "Vie =",       IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Vie" },
    { Cat_Action,    "Action : Definir le score",            "Score =",     IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Score" },
    { Cat_Action,    "Action : Retirer des points",          "-Score",      IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Points" },
    { Cat_Action,    "Action : Remettre le score a zero",    "Score=0",     IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Remettre la vie au maximum",  "Vie max",     IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Cacher l'objet",              "Cacher",      IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Afficher l'objet",            "Afficher",    IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Alterner visible / invisible", "Bascule vis.", IM_COL32(70, 130, 210, 255), P_NONE,     nullptr },
    { Cat_Action,    "Action : Bloquer les controles du joueur", "Gel joueur", IM_COL32(70, 130, 210, 255), P_NONE,    nullptr },
    { Cat_Action,    "Action : Debloquer les controles du joueur", "Degel joueur", IM_COL32(70, 130, 210, 255), P_NONE, nullptr },
    { Cat_Action,    "Action : Regler le metallique",        "Metal =",     IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Metallique (0-1)" },
    { Cat_Action,    "Action : Regler la rugosite",          "Rugosite =",  IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Rugosite (0-1)" },
    { Cat_Action,    "Action : Regler l'intensite emissive", "Emissif =",   IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Intensite" },
    { Cat_Action,    "Action : Regler l'intensite de la lumiere", "Lum. =", IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Intensite" },
    { Cat_Action,    "Action : Regler la portee de la lumiere", "Portee =", IM_COL32(70, 130, 210, 255),  P_AMOUNT,    "Portee" },
    { Cat_Variable,  "Maths : Multiplier une variable",      "Var x N",     IM_COL32(80, 175, 100, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Variable,  "Maths : Diviser une variable",         "Var / N",     IM_COL32(80, 175, 100, 255),  P_VAR_NUM,   "Variable / valeur" },
    { Cat_Variable,  "Variable : Copier la vie dedans",      "Var=Vie",     IM_COL32(80, 175, 100, 255),  P_VARNAME,   "Nom de la variable" },
    { Cat_Variable,  "Variable : Copier le score dedans",    "Var=Score",   IM_COL32(80, 175, 100, 255),  P_VARNAME,   "Nom de la variable" },
    { Cat_Variable,  "Variable : Copier la distance au joueur dedans", "Var=Dist", IM_COL32(80, 175, 100, 255), P_VARNAME, "Nom de la variable" },
    { Cat_Action,    "Action : Teleporter cet objet vers le joueur", "TP->Joueur", IM_COL32(70, 130, 210, 255), P_NONE, nullptr },
    { Cat_Action,    "Action : Teleporter le joueur vers cet objet", "TP<-Joueur", IM_COL32(70, 130, 210, 255), P_NONE, nullptr },
    { Cat_Action,    "Action : Inverser la gravite",         "Gravite inv.", IM_COL32(70, 130, 210, 255), P_NONE,      nullptr },
    { Cat_Action,    "Action : Faire sauter le joueur",      "Sauter",      IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Arreter net le joueur",       "Stop joueur", IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
    { Cat_Action,    "Action : Pousser le joueur",           "Pousser",     IM_COL32(70, 130, 210, 255),  P_VEC,       "Force (x, y, z)" },
    { Cat_Action,    "Action : Definir la position de cet objet", "Pos =",  IM_COL32(70, 130, 210, 255),  P_VEC,       "Position" },
    { Cat_Action,    "Action : Definir la rotation de cet objet", "Rot =",  IM_COL32(70, 130, 210, 255),  P_VEC,       "Rotation (degres)" },
    { Cat_Action,    "Action : Regler la force de saut du joueur", "Saut =", IM_COL32(70, 130, 210, 255), P_AMOUNT,    "Force" },
    { Cat_Event,     "Evenement : Toutes les X secondes",    "Intervalle",  IM_COL32(205, 70, 70, 255),   P_SECONDS,   "Secondes" },
    { Cat_Action,    "Action : Activer ce point de passage",  "Checkpoint",  IM_COL32(70, 130, 210, 255),  P_NONE,      nullptr },
};
static const int NODE_TYPE_COUNT = (int)(sizeof(NODE_TYPES) / sizeof(NODE_TYPES[0]));

struct BlueprintNode {
    int type = 0;
    ImVec2 pos{ 0.0f, 0.0f };
    float a = 1.0f;
    float b = 10.0f;
    std::string sparam;
    WEngine::Vec3 vec{ 1.0f, 1.0f, 1.0f };
    float timer = 0.0f; // etat d'execution (ex: "Toutes les X secondes"), jamais sauvegarde
    // Fils d'execution (comme les broches blanches d'Unreal) : index du bloc
    // suivant dans le Blueprint, -1 = rien de branche. Pour une condition,
    // next = sortie "Vrai" et nextFalse = sortie "Faux".
    int next = -1;
    int nextFalse = -1;
};

static const char* SHAPE_NAMES[] = { "Cube", "Sphere", "Cylindre", "Camera", "Texte", "Modele 3D", "Lumiere", "Depart Joueur", "Point de passage" };
enum ShapeType { Shape_Cube = 0, Shape_Sphere = 1, Shape_Cylinder = 2, Shape_Camera = 3, Shape_Text = 4, Shape_Model = 5, Shape_Light = 6, Shape_PlayerStart = 7, Shape_Checkpoint = 8 };

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
    bool hidden = false; // masque l'objet sans le detruire (collision/logique intactes)
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
static const float BP_NODE_W = 230.0f;
static const float BP_NODE_H = 66.0f;
static const float BP_HEADER_H = 24.0f;

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
    float jumpForce = 8.0f;
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
        camObj.collision = false;
        camObj.blueprint = DefaultBlueprint(Shape_Camera); // active et fixe des le debut de la partie
        m_Objects.push_back(camObj);

        // Point d'apparition du joueur (comme le PlayerStart d'Unreal) :
        // sans lui, Jouer (F5) ne fait apparaitre aucun personnage.
        SceneObject startObj;
        startObj.name = "Depart Joueur";
        startObj.shape = Shape_PlayerStart;
        startObj.position = { 0.0f, 0.0f, 6.0f };
        startObj.rotationEuler = { 0.0f, 180.0f, 0.0f }; // regarde vers la scene
        startObj.collision = false;
        m_Objects.push_back(startObj);

        // Point de passage de demo, en haut des plateformes : l'atteindre
        // change le point de reapparition du joueur.
        {
            SceneObject cp;
            cp.name = "Point de passage 1";
            cp.shape = Shape_Checkpoint;
            cp.position = { 7.0f, 5.0f, 3.0f };
            // collision reste true : PlayerTouches() en a besoin pour
            // detecter le contact (Shape_Checkpoint ne bloque jamais le
            // joueur physiquement, c'est gere a part dans CollidesAt/etc.).
            cp.blueprint = DefaultBlueprint(Shape_Checkpoint);
            m_Objects.push_back(cp);
        }

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
        ResetUndoBaseline();
    }

    // --- Blueprints par defaut, adaptes au type d'objet ---------------
    // (une camera n'a rien a faire avec un piege : elle recoit une chaine
    // qui la rend reellement utile - elle devient la vue du jeu.)
    static std::vector<BlueprintNode> DefaultBlueprint(int shape) {
        std::vector<BlueprintNode> bp = DefaultBlueprintNodes(shape);
        LinkSequential(bp);
        LayoutChains(bp);
        return bp;
    }

    static int NodeCategory(const BlueprintNode& n) {
        return (n.type >= 0 && n.type < NODE_TYPE_COUNT) ? NODE_TYPES[n.type].category : -1;
    }

    // Relie chaque bloc au suivant dans la liste, sauf quand le suivant est
    // un evenement (debut d'une autre chaine). C'etait la regle d'execution
    // avant les fils : les anciennes scenes gardent donc le meme comportement.
    static void LinkSequential(std::vector<BlueprintNode>& bp) {
        for (int i = 0; i < (int)bp.size(); i++) {
            bp[i].next = -1;
            bp[i].nextFalse = -1;
            if (i + 1 < (int)bp.size() && NodeCategory(bp[i + 1]) != Cat_Event && NodeCategory(bp[i + 1]) >= 0) {
                bp[i].next = i + 1;
            }
        }
    }

    // Un fil ne peut pas pointer hors du Blueprint ni vers un evenement (un
    // evenement n'a pas de broche d'entree), et seule une condition a une
    // sortie "Faux".
    static void SanitizeLinks(std::vector<BlueprintNode>& bp) {
        int n = (int)bp.size();
        for (auto& node : bp) {
            if (node.next < 0 || node.next >= n || NodeCategory(bp[node.next]) == Cat_Event) node.next = -1;
            if (node.nextFalse < 0 || node.nextFalse >= n || NodeCategory(bp[node.nextFalse]) == Cat_Event) node.nextFalse = -1;
            if (NodeCategory(node) != Cat_Condition) node.nextFalse = -1;
        }
    }

    static void RemoveNode(std::vector<BlueprintNode>& bp, int index) {
        if (index < 0 || index >= (int)bp.size()) return;
        bp.erase(bp.begin() + index);
        for (auto& node : bp) {
            for (int* link : { &node.next, &node.nextFalse }) {
                if (*link == index) *link = -1;
                else if (*link > index) (*link)--;
            }
        }
    }

    // Place chaque chaine sur une ligne, de gauche a droite, comme un graphe
    // Unreal (evenement a gauche, puis les blocs relies dans l'ordre).
    // Au-dela de 3 blocs, la chaine continue sur la ligne du dessous pour
    // rester lisible sans devoir dezoomer.
    static void LayoutChains(std::vector<BlueprintNode>& bp) {
        const int PER_ROW = 3;
        int row = 0;
        std::vector<bool> placed(bp.size(), false);
        for (int i = 0; i < (int)bp.size(); i++) {
            if (NodeCategory(bp[i]) != Cat_Event) continue;
            int col = 0, cur = i;
            while (cur >= 0 && cur < (int)bp.size() && !placed[cur]) {
                placed[cur] = true;
                if (col == PER_ROW) { col = 0; row++; }
                bp[cur].pos = ImVec2(40.0f + col * (BP_NODE_W + 110.0f), 40.0f + row * 110.0f);
                col++;
                cur = bp[cur].next;
            }
            row += 2;
        }
    }

    static std::vector<BlueprintNode> DefaultBlueprintNodes(int shape) {
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
            // Fixe par defaut, comme une vraie camera de jeu : elle ne bouge
            // pas toute seule. Remplace ce bloc par "Suivre le joueur" si tu
            // veux qu'elle bouge avec lui.
            add(N_ACT_CAM_ACTIVATE);
            return bp;
        }
        if (shape == Shape_PlayerStart) {
            return bp; // pas de logique par defaut : c'est juste un repere de position
        }
        if (shape == Shape_Checkpoint) {
            add(N_EVT_COLLISION);
            add(N_ACT_SET_CHECKPOINT);
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
        // Le rendu 3D occupe uniquement la zone centrale (entre les panneaux),
        // comme le viewport d'Unreal : avant, la scene etait dessinee sous
        // les panneaux et une partie restait cachee derriere eux.
        auto& window = WEngine::Application::Get().GetWindow();
        float vx, vy, vw, vh;
        WEngine::ImGuiLayer::GetViewportRect(vx, vy, vw, vh);
        if (vw < 16.0f || vh < 16.0f) { vx = 0.0f; vy = 0.0f; vw = (float)window.GetWidth(); vh = (float)window.GetHeight(); }
        m_ViewX = vx; m_ViewY = vy; m_ViewportW = vw; m_ViewportH = vh;

        bool uiHasMouse = ImGui::GetIO().WantCaptureMouse;
        float dt = ts.GetSeconds();
        if (dt > 0.1f) dt = 0.1f; // evite un saut geant apres une pause

        if (m_PlayerMode) {
            UpdatePlayer(ts, uiHasMouse);
            RunBlueprints(dt);
        } else {
            UpdateViewportInput(ts, uiHasMouse);
        }

        m_Time += dt;
        m_LastFrameTime = dt;
        if (m_StatusTimer > 0.0f) m_StatusTimer -= dt;


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
            m_PreviewFB->Unbind(window.GetWidth(), window.GetHeight());
            m_PreviewValid = true;
        }

        // 2) Vue principale
        m_NoViewInPlay = m_PlayerMode && !m_PlayerHasCharacter && m_Play.activeCamera < 0;
        if (m_NoViewInPlay) {
            // Rien pour donner une vue (ni personnage, ni camera activee) :
            // un ecran noir volontaire et explicite plutot qu'un rendu casse.
            WEngine::Renderer::SetClearColor(0.0f, 0.0f, 0.0f, 1.0f);
            WEngine::Renderer::Clear();
            return;
        }

        WEngine::Renderer::SetClearColor(m_SkyColor.x, m_SkyColor.y, m_SkyColor.z, 1.0f);
        WEngine::Renderer::Clear();
        WEngine::Renderer::SetViewport((int)m_ViewX, (int)((float)window.GetHeight() - m_ViewY - m_ViewportH),
                                       (int)m_ViewportW, (int)m_ViewportH);

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
        if (m_ShowGrid && !m_PlayerMode && !m_GameView) m_Grid->Draw();

        if (m_ViewMode == 2) WEngine::Renderer::SetWireframe(true);
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            auto& obj = m_Objects[i];
            if (obj.destroyed || obj.hidden) continue;
            if (obj.shape == Shape_Text) continue; // rendu en overlay 2D (OnImGuiRender)
            // Camera, lumiere et depart joueur sont des reperes d'edition :
            // invisibles en jeu et en "Vue jeu" (touche G), comme dans Unreal.
            bool editorIconsHidden = m_PlayerMode || m_GameView;
            if (obj.shape == Shape_Camera) {
                if (i == skipCamera || editorIconsHidden) continue;
                DrawCameraMarker(obj, i == m_Selected);
                continue;
            }
            if (obj.shape == Shape_Light) {
                if (editorIconsHidden) continue;
                DrawLightMarker(obj, i == m_Selected);
                continue;
            }
            if (obj.shape == Shape_PlayerStart) {
                if (editorIconsHidden) continue;
                DrawPlayerStartMarker(obj, i == m_Selected);
                continue;
            }
            if (obj.shape == Shape_Checkpoint) {
                // Visible aussi pendant le jeu : le joueur doit pouvoir le
                // reperer pour savoir ou il va reapparaitre.
                DrawCheckpointMarker(obj, !m_PlayerMode && i == m_Selected);
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

        if (m_PlayerMode && m_PlayerHasCharacter) {
            DrawPlayer();
        }
        if (m_ViewMode == 2) WEngine::Renderer::SetWireframe(false);

        if (withGizmoAndPlayer && !m_PlayerMode && !m_GameView && m_Selected >= 0 && m_Selected < (int)m_Objects.size()
            && m_Objects[m_Selected].shape != Shape_Text) {
            WEngine::Renderer::ClearDepth();
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

    // Repere du point d'apparition du joueur : une base + une fleche qui
    // pointe dans la direction ou le personnage regardera en apparaissant.
    void DrawPlayerStartMarker(const SceneObject& obj, bool selected) {
        WEngine::Mat4 base = WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate(obj.position), WEngine::Mat4::RotateY(obj.rotationEuler.y * DEG2RAD));
        WEngine::Vec3 tint = selected ? WEngine::Vec3(1.0f, 1.0f, 1.0f) : WEngine::Vec3(0.15f, 0.85f, 0.95f);

        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);

        WEngine::Mat4 disc = WEngine::Mat4::Multiply(base, WEngine::Mat4::Scale({ 0.5f, 0.04f, 0.5f }));
        SetModel(disc);
        m_Cylinder->Draw();

        WEngine::Mat4 arrow = WEngine::Mat4::Multiply(base, WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate({ 0.0f, 0.05f, -0.3f }), WEngine::Mat4::Scale({ 0.14f, 0.08f, 0.4f })));
        SetModel(arrow);
        m_Cube->Draw();

        WEngine::Mat4 post = WEngine::Mat4::Multiply(base, WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate({ 0.0f, 0.9f, 0.0f }), WEngine::Mat4::Scale({ 0.18f, 1.8f, 0.18f })));
        SetModel(post);
        m_Cylinder->Draw();
    }

    // Un drapeau : un mat + un fanion qui se voit meme pendant la partie,
    // pour que le joueur sache ou il reapparaitra apres l'avoir touche.
    void DrawCheckpointMarker(const SceneObject& obj, bool selected) {
        WEngine::Mat4 base = WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate(obj.position), WEngine::Mat4::RotateY(obj.rotationEuler.y * DEG2RAD));
        WEngine::Vec3 tint = selected ? WEngine::Vec3(1.0f, 1.0f, 1.0f) : WEngine::Vec3(0.95f, 0.75f, 0.15f);

        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);
        m_Shader->SetFloat3(m_LocTint, tint.x, tint.y, tint.z);

        WEngine::Mat4 pole = WEngine::Mat4::Multiply(base, WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate({ 0.0f, 1.0f, 0.0f }), WEngine::Mat4::Scale({ 0.1f, 2.0f, 0.1f })));
        SetModel(pole);
        m_Cylinder->Draw();

        WEngine::Mat4 flag = WEngine::Mat4::Multiply(base, WEngine::Mat4::Multiply(
            WEngine::Mat4::Translate({ 0.32f, 1.7f, 0.0f }), WEngine::Mat4::Scale({ 0.64f, 0.4f, 0.05f })));
        SetModel(flag);
        m_Cube->Draw();

        WEngine::Mat4 base_disc = WEngine::Mat4::Multiply(base, WEngine::Mat4::Scale({ 0.55f, 0.03f, 0.55f }));
        SetModel(base_disc);
        m_Cylinder->Draw();
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
        outScreen.x = m_ViewX + (ndcX * 0.5f + 0.5f) * m_ViewportW;
        outScreen.y = m_ViewY + (1.0f - (ndcY * 0.5f + 0.5f)) * m_ViewportH;
        return true;
    }


    // ================= Historique / presse-papier =====================

    // L'historique compare l'etat "valide" precedent a l'etat actuel une fois
    // chaque geste termine (souris relachee, champ quitte, touche) : toute
    // modification, d'ou qu'elle vienne (Details, Blueprint, gizmo, Navigateur
    // de contenu...), devient ainsi annulable en une seule entree, comme
    // dans Unreal.
    void PushUndo() { m_UndoCheckNeeded = true; }

    std::string SerializeObjects(const std::vector<SceneObject>& objs) const {
        std::ostringstream ss;
        for (const auto& o : objs) SerializeObject(ss, o);
        return ss.str();
    }

    void CommitUndoIfChanged() {
        if (m_PlayerMode) return;
        std::string now = SerializeObjects(m_Objects);
        if (now == m_CommittedText) return;
        m_UndoStack.push_back(m_Committed);
        if (m_UndoStack.size() > 64) m_UndoStack.erase(m_UndoStack.begin());
        m_RedoStack.clear();
        m_Committed = m_Objects;
        m_CommittedText = now;
    }

    void ResetUndoBaseline() {
        m_Committed = m_Objects;
        m_CommittedText = SerializeObjects(m_Objects);
    }

    void Undo() {
        CommitUndoIfChanged();
        if (m_UndoStack.empty()) { SetStatus("Rien a annuler"); return; }
        m_RedoStack.push_back(m_Objects);
        m_Objects = m_UndoStack.back();
        m_UndoStack.pop_back();
        ResetUndoBaseline();
        ClampSelection();
        SetStatus("Annule");
    }

    void Redo() {
        if (m_RedoStack.empty()) { SetStatus("Rien a retablir"); return; }
        m_UndoStack.push_back(m_Objects);
        m_Objects = m_RedoStack.back();
        m_RedoStack.pop_back();
        ResetUndoBaseline();
        ClampSelection();
        SetStatus("Retabli");
    }

    // Nom unique facon Unreal : "Cube 3" duplique devient "Cube 4" (et non
    // "Cube 3 (copie) (copie)").
    std::string MakeUniqueName(const std::string& name) const {
        std::string base = name;
        size_t end = base.size();
        while (end > 0 && std::isdigit((unsigned char)base[end - 1])) end--;
        if (end < base.size() && end > 0 && base[end - 1] == ' ') base = base.substr(0, end - 1);
        else if (end < base.size()) base = base.substr(0, end);
        int best = 0;
        for (const auto& o : m_Objects) {
            if (o.name == base) { best = std::max(best, 1); continue; }
            if (o.name.size() <= base.size() + 1 || o.name.compare(0, base.size() + 1, base + " ") != 0) continue;
            std::string suffix = o.name.substr(base.size() + 1);
            if (suffix.empty() || suffix.size() > 6 || !std::all_of(suffix.begin(), suffix.end(), [](char c) { return std::isdigit((unsigned char)c) != 0; })) continue;
            best = std::max(best, std::atoi(suffix.c_str()));
        }
        return base + " " + std::to_string(best + 1);
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
        copy.name = MakeUniqueName(copy.name);
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
            copy.name = MakeUniqueName(copy.name);
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
        f << "WENGINE_SCENE 3\n";
        f << "sky " << m_SkyColor.x << " " << m_SkyColor.y << " " << m_SkyColor.z << "\n";
        f << "light " << m_LightDir.x << " " << m_LightDir.y << " " << m_LightDir.z << "\n";
        f << "lightcol " << m_LightColor.x << " " << m_LightColor.y << " " << m_LightColor.z << "\n";
        f << "ambient " << m_Ambient << "\n";
        f << "playermodel " << m_PlayerModelPath << "\n";
        f << "playertint " << m_PlayerTint.x << " " << m_PlayerTint.y << " " << m_PlayerTint.z << "\n";
        f << "playerscale " << m_PlayerScale << "\n";
        for (const auto& o : m_Objects) SerializeObject(f, o);
        SetStatus("Scene sauvegardee dans " + path);
        return true;
    }

    static void SerializeObject(std::ostream& f, const SceneObject& o) {
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
              << " " << n.next << " " << n.nextFalse << " " << n.sparam << "\n";
        }
        f << "ENDOBJECT\n";
    }

    bool LoadScene(const std::string& path) {
        std::ifstream f(path);
        if (!f) { SetStatus("Fichier introuvable : " + path); return false; }

        std::vector<SceneObject> loaded;
        SceneObject cur;
        bool inObject = false;
        int version = 1;
        std::string line;
        while (std::getline(f, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line == "OBJECT") { cur = SceneObject{}; cur.blueprint.clear(); inObject = true; continue; }
            if (line == "ENDOBJECT") {
                if (inObject) {
                    // Avant la version 3, l'ordre des blocs faisait office de
                    // fils : on recree exactement les memes liens.
                    if (version < 3) LinkSequential(cur.blueprint);
                    SanitizeLinks(cur.blueprint);
                    loaded.push_back(cur);
                }
                inObject = false;
                continue;
            }

            std::istringstream ss(line);
            std::string key;
            ss >> key;
            auto rest = [&]() { std::string r; std::getline(ss, r); if (!r.empty() && r[0] == ' ') r.erase(0, 1); return r; };

            if (key == "WENGINE_SCENE") { ss >> version; continue; }
            if (!inObject) {
                if (key == "sky") ss >> m_SkyColor.x >> m_SkyColor.y >> m_SkyColor.z;
                else if (key == "light") ss >> m_LightDir.x >> m_LightDir.y >> m_LightDir.z;
                else if (key == "lightcol") ss >> m_LightColor.x >> m_LightColor.y >> m_LightColor.z;
                else if (key == "ambient") ss >> m_Ambient;
                else if (key == "playermodel") m_PlayerModelPath = rest();
                else if (key == "playertint") ss >> m_PlayerTint.x >> m_PlayerTint.y >> m_PlayerTint.z;
                else if (key == "playerscale") ss >> m_PlayerScale;
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
                if (version >= 3) ss >> n.next >> n.nextFalse;
                n.sparam = rest();
                if (n.type >= 0 && n.type < NODE_TYPE_COUNT) cur.blueprint.push_back(n);
            }
        }

        if (loaded.empty()) { SetStatus("Scene vide ou illisible : " + path); return false; }
        CommitUndoIfChanged();
        PushUndo();
        m_Objects = loaded;
        ClampSelection();
        m_Selected = -1;
        SetStatus("Scene chargee depuis " + path);
        return true;
    }

    // ================= Moteur de Blueprint =============================

    void StartPlay() {
        // La camera d'edition est restauree a l'arret (comme le PIE d'Unreal) :
        // sinon elle reste figee la ou une camera de jeu fixe l'a laissee, et
        // on peut se retrouver a l'editer depuis l'interieur du repere 3D de
        // cette meme camera, ce qui casse completement l'affichage.
        m_EditorCamBackup = m_Camera;

        CommitUndoIfChanged();
        m_NavMode = Nav_None;
        m_DraggingAxis = -1;
        m_SavedObjects = m_Objects;   // instantane : l'arret restaure tout
        m_Play = PlayState{};
        m_Pending.clear();
        m_PlayerFrozen = false;
        m_LoopWarned = false;
        m_ClearUiFocus = true;

        for (auto& o : m_Objects) { o.destroyed = false; o.touching = false; o.hidden = false; }

        // Le personnage n'apparait que s'il y a un "Depart Joueur" pose dans
        // la scene (comme le PlayerStart d'Unreal) : sinon pas de personnage
        // qui surgit n'importe ou devant la camera d'edition.
        m_PlayerHasCharacter = false;
        for (auto& o : m_Objects) {
            if (o.destroyed || o.shape != Shape_PlayerStart) continue;
            m_PlayerSpawn = o.position;
            m_PlayerSpawn.y += PlayerHalfHeight();
            m_PlayerFacingYaw = o.rotationEuler.y * DEG2RAD;
            m_PlayerHasCharacter = true;
            break;
        }
        m_PlayerPos = m_PlayerSpawn;
        m_PlayerVelY = 0.0f;
        m_PlayerGrounded = true;
        m_PlayerVelXZ = { 0.0f, 0.0f, 0.0f };
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
        m_Camera = m_EditorCamBackup; // on retrouve la vue d'edition d'avant le Jouer
        m_Camera.ResetLook();
        if (m_Selected >= (int)m_Objects.size()) m_Selected = -1;
        if (m_ScriptTarget >= (int)m_Objects.size()) { m_ScriptTarget = -1; m_ShowScriptEditor = false; }
        ResetUndoBaseline();
    }

    void TogglePlay() {
        if (m_PlayerMode) StopPlay(); else StartPlay();
    }

    void AddMessage(const std::string& text) {
        m_Play.messages.push_back({ text, 4.0f });
        if (m_Play.messages.size() > 6) m_Play.messages.erase(m_Play.messages.begin());
    }

    bool PlayerTouches(const SceneObject& obj) const {
        if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light || obj.shape == Shape_PlayerStart) return false;
        if (!obj.collision) return false;
        // Marge un peu plus large que celle du blocage (CollidesAt), sinon le
        // joueur s'arrete pile au bord sans jamais "toucher" l'objet.
        const float TOUCH_MARGIN = 0.15f;
        float halfX = std::fabs(obj.scale.x) * 0.5f + PlayerRadius() + TOUCH_MARGIN;
        float halfZ = std::fabs(obj.scale.z) * 0.5f + PlayerRadius() + TOUCH_MARGIN;
        float minY = obj.position.y - std::fabs(obj.scale.y) * 0.5f - 0.2f;
        float maxY = obj.position.y + std::fabs(obj.scale.y) * 0.5f + 0.2f;
        float feet = m_PlayerPos.y - PlayerHalfHeight();
        float head = m_PlayerPos.y + PlayerHalfHeight();
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
        // "Toutes les X secondes" : chaque bloc garde son propre chronometre
        // (jamais sauvegarde) au lieu de dependre d'un evenement Tick a la main.
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (m_Objects[i].destroyed) continue;
            std::vector<int> starts;
            auto& bp = m_Objects[i].blueprint;
            for (int j = 0; j < (int)bp.size(); j++) {
                if (bp[j].type != N_EVT_INTERVAL) continue;
                bp[j].timer += dt;
                float interval = bp[j].a > 0.0f ? bp[j].a : 1.0f;
                if (bp[j].timer >= interval) {
                    bp[j].timer -= interval;
                    if (bp[j].next >= 0) starts.push_back(bp[j].next);
                }
            }
            for (int s : starts) RunChain(i, s);
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
                WEngine::Vec3 offset = m_Camera.Forward() * (-5.0f * m_PlayerScale) + WEngine::Vec3(0.0f, 2.0f * m_PlayerScale, 0.0f);
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
            for (auto& o : m_Objects) { o.destroyed = false; o.touching = false; o.hidden = false; }
            m_Pending.clear();
            m_PlayerFrozen = false;
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

    static int KeyCodeFor(const std::string& s) {
        char c = s.empty() ? 'E' : (char)std::toupper((unsigned char)s[0]);
        if (c >= 'A' && c <= 'Z') return GLFW_KEY_A + (c - 'A');
        if (c >= '0' && c <= '9') return GLFW_KEY_0 + (c - '0');
        return -1;
    }

    bool KeyMatches(const std::string& s, int keyCode) const {
        int key = KeyCodeFor(s);
        return key >= 0 && keyCode == key;
    }

    void FireEvent(int objIndex, int eventType, int keyCode = -1) {
        if (objIndex < 0 || objIndex >= (int)m_Objects.size()) return;
        // copie des indices d'abord : la chaine peut modifier la scene
        std::vector<int> starts;
        const auto& bp = m_Objects[objIndex].blueprint;
        for (int i = 0; i < (int)bp.size(); i++) {
            if (bp[i].type != eventType) continue;
            if (eventType == N_EVT_KEY && !KeyMatches(bp[i].sparam, keyCode)) continue;
            if (bp[i].next >= 0) starts.push_back(bp[i].next);
        }
        for (int s : starts) RunChain(objIndex, s);
    }

    // Suit les fils d'execution a partir d'un bloc jusqu'a : un fil vide, une
    // attente (reprise plus tard), ou le garde-fou anti-boucle infinie.
    void RunChain(int objIndex, int start) {
        int cur = start;
        for (int steps = 0; cur >= 0; steps++) {
            if (objIndex < 0 || objIndex >= (int)m_Objects.size()) return;
            if (m_Objects[objIndex].destroyed) return;
            if (cur >= (int)m_Objects[objIndex].blueprint.size()) return;
            if (steps >= MAX_CHAIN_STEPS) {
                // Comme le "Infinite loop detected" d'Unreal : des fils qui
                // tournent en rond sans "Attendre" gelaient tout le jeu.
                if (!m_LoopWarned) {
                    AddMessage("Boucle infinie dans le Blueprint de " + m_Objects[objIndex].name + " (ajoute un bloc Attendre)");
                    m_LoopWarned = true;
                }
                return;
            }

            BlueprintNode node = m_Objects[objIndex].blueprint[cur]; // copie : l'action peut modifier le vecteur
            if (node.type < 0 || node.type >= NODE_TYPE_COUNT) return;
            int cat = NODE_TYPES[node.type].category;

            if (cat == Cat_Event) return;
            if (cat == Cat_Condition) {
                m_CondObjectPos = m_Objects[objIndex].position;
                m_CondObjectTouching = m_Objects[objIndex].touching;
                cur = EvalCondition(node) ? node.next : node.nextFalse;
                continue;
            }
            if (node.type == N_ACT_WAIT) {
                // Garde-fou : "Tick -> Attendre" empilerait une chaine par frame.
                if (node.next >= 0 && (int)m_Pending.size() < MAX_PENDING) {
                    m_Pending.push_back({ objIndex, node.next, node.a > 0.0f ? node.a : 1.0f });
                }
                return;
            }
            if (!RunAction(objIndex, node)) return;
            cur = node.next;
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
            case N_COND_LIFE_LE:  return m_Play.life <= (int)node.a;
            case N_COND_LIFE_GE:  return m_Play.life >= (int)node.a;
            case N_COND_SCORE_GE: return m_Play.score >= (int)node.a;
            case N_COND_SCORE_LE: return m_Play.score <= (int)node.a;
            case N_COND_VAR_GT: {
                auto it = m_Play.vars.find(node.sparam);
                return (it == m_Play.vars.end() ? 0.0f : it->second) > node.a;
            }
            case N_COND_VAR_LT: {
                auto it = m_Play.vars.find(node.sparam);
                return (it == m_Play.vars.end() ? 0.0f : it->second) < node.a;
            }
            case N_COND_VAR_GE: {
                auto it = m_Play.vars.find(node.sparam);
                return (it == m_Play.vars.end() ? 0.0f : it->second) >= node.a;
            }
            case N_COND_VAR_LE: {
                auto it = m_Play.vars.find(node.sparam);
                return (it == m_Play.vars.end() ? 0.0f : it->second) <= node.a;
            }
            case N_COND_KEY_HELD: {
                int key = KeyCodeFor(node.sparam);
                return key >= 0 && WEngine::Input::IsKeyPressed(key);
            }
            case N_COND_MOVING:       return m_PlayerMoving;
            case N_COND_TOUCHING_NOW: return m_CondObjectTouching;
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
            case N_ACT_SET_LIFE:   m_Play.life = (int)node.a; break;
            case N_ACT_SET_SCORE:  m_Play.score = (int)node.a; break;
            case N_ACT_SUB_SCORE:  m_Play.score -= (int)(node.a != 0.0f ? node.a : 1.0f); break;
            case N_ACT_RESET_SCORE: m_Play.score = 0; break;
            case N_ACT_FULL_HEAL:  m_Play.life = 3; break;
            case N_ACT_HIDE_OBJECT:   obj.hidden = true; break;
            case N_ACT_SHOW_OBJECT:   obj.hidden = false; break;
            case N_ACT_TOGGLE_VISIBLE: obj.hidden = !obj.hidden; break;
            case N_ACT_FREEZE_PLAYER:   m_PlayerFrozen = true; break;
            case N_ACT_UNFREEZE_PLAYER: m_PlayerFrozen = false; break;
            case N_ACT_SET_METALLIC:  obj.metallic = Clamp01(node.a); break;
            case N_ACT_SET_ROUGHNESS: obj.roughness = Clamp01(node.a) < 0.02f ? 0.02f : Clamp01(node.a); break;
            case N_ACT_SET_EMISSIVE:  obj.emissiveStrength = node.a; break;
            case N_ACT_SET_LIGHT_INTENSITY: obj.lightIntensity = node.a; break;
            case N_ACT_SET_LIGHT_RANGE:     obj.lightRadius = node.a; break;
            case N_MATH_MUL: m_Play.vars[node.sparam] *= node.a; break;
            case N_MATH_DIV: if (node.a != 0.0f) m_Play.vars[node.sparam] /= node.a; break;
            case N_VAR_FROM_LIFE:  m_Play.vars[node.sparam] = (float)m_Play.life; break;
            case N_VAR_FROM_SCORE: m_Play.vars[node.sparam] = (float)m_Play.score; break;
            case N_VAR_FROM_DIST_PLAYER: {
                WEngine::Vec3 d = m_PlayerPos - obj.position;
                m_Play.vars[node.sparam] = std::sqrt(WEngine::Vec3::Dot(d, d));
                break;
            }
            case N_ACT_TP_TO_PLAYER:   obj.position = m_PlayerPos; break;
            case N_ACT_TP_PLAYER_HERE: m_PlayerPos = obj.position; m_PlayerVelY = 0.0f; break;
            case N_ACT_INVERT_GRAVITY: m_Play.gravityForce = -m_Play.gravityForce; break;
            case N_ACT_JUMP:
                m_PlayerVelY = m_Play.jumpForce;
                m_PlayerGrounded = false;
                break;
            case N_ACT_STOP_PLAYER:
                m_PlayerVelXZ = { 0.0f, 0.0f, 0.0f };
                m_PlayerVelY = 0.0f;
                break;
            case N_ACT_PUSH_PLAYER:
                m_PlayerVelXZ.x += node.vec.x;
                m_PlayerVelXZ.z += node.vec.z;
                m_PlayerVelY += node.vec.y;
                if (node.vec.y != 0.0f) m_PlayerGrounded = false;
                break;
            case N_ACT_SET_POSITION: obj.position = node.vec; break;
            case N_ACT_SET_ROTATION: obj.rotationEuler = node.vec; break;
            case N_ACT_SET_JUMP_FORCE: m_Play.jumpForce = node.a; break;
            case N_ACT_SET_CHECKPOINT:
                m_PlayerSpawn = obj.position;
                m_PlayerSpawn.y += PlayerHalfHeight();
                m_PlayerFacingYaw = obj.rotationEuler.y * DEG2RAD;
                AddMessage("Point de passage active");
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
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light || obj.shape == Shape_PlayerStart || obj.shape == Shape_Checkpoint) continue;
            float halfX = std::fabs(obj.scale.x) * 0.5f, halfZ = std::fabs(obj.scale.z) * 0.5f;
            if (x >= obj.position.x - halfX && x <= obj.position.x + halfX &&
                z >= obj.position.z - halfZ && z <= obj.position.z + halfZ) {
                float topY = obj.position.y + obj.scale.y * 0.5f;
                if (topY <= refY + 0.2f * m_PlayerScale && topY > best) best = topY;
            }
        }
        return best;
    }

    // La capsule de collision suit la Taille choisie dans "Personnage" :
    // sinon un personnage agrandi/reduit semblait traverser les objets ou
    // rester bloque dans le vide (son gabarit visuel ne correspondait plus
    // du tout a la zone qui bloque vraiment ses deplacements).
    // Plafond : le point le plus bas parmi les objets dont le dessous est
    // au-dessus de refY (pour empecher de sauter a travers le sol d'une
    // plateforme et de continuer sa course la-dedans).
    float CeilingHeightAt(float x, float z, float refY) {
        float best = 1e9f;
        for (auto& obj : m_Objects) {
            if (obj.destroyed || !obj.collision) continue;
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light || obj.shape == Shape_PlayerStart || obj.shape == Shape_Checkpoint) continue;
            float halfX = std::fabs(obj.scale.x) * 0.5f, halfZ = std::fabs(obj.scale.z) * 0.5f;
            if (x >= obj.position.x - halfX && x <= obj.position.x + halfX &&
                z >= obj.position.z - halfZ && z <= obj.position.z + halfZ) {
                float botY = obj.position.y - obj.scale.y * 0.5f;
                if (botY >= refY - 0.05f * m_PlayerScale && botY < best) best = botY;
            }
        }
        return best;
    }

    static constexpr float PLAYER_RADIUS_BASE = 0.35f;
    static constexpr float PLAYER_HALF_HEIGHT_BASE = 1.0f;
    float PlayerRadius() const { return PLAYER_RADIUS_BASE * m_PlayerScale; }
    float PlayerHalfHeight() const { return PLAYER_HALF_HEIGHT_BASE * m_PlayerScale; }
    static constexpr int MAX_OBJECTS = 400;
    static constexpr int MAX_PENDING = 256;
    static constexpr int MAX_CHAIN_STEPS = 1000;

    // Bloque le joueur devant les cotes des objets (au lieu de les
    // traverser) : ignore un objet si le joueur a deja les pieds au niveau
    // (ou au-dessus) de son sommet, pour pouvoir marcher dessus librement.
    bool CollidesAt(float x, float z, float centerY) {
        float feet = centerY - PlayerHalfHeight();
        float head = centerY + PlayerHalfHeight();
        for (auto& obj : m_Objects) {
            if (obj.destroyed || !obj.collision) continue;
            if (obj.shape == Shape_Camera || obj.shape == Shape_Text || obj.shape == Shape_Light || obj.shape == Shape_PlayerStart || obj.shape == Shape_Checkpoint) continue;
            float halfX = std::fabs(obj.scale.x) * 0.5f + PlayerRadius();
            float halfZ = std::fabs(obj.scale.z) * 0.5f + PlayerRadius();
            float minY = obj.position.y - std::fabs(obj.scale.y) * 0.5f;
            float maxY = obj.position.y + std::fabs(obj.scale.y) * 0.5f;
            if (feet >= maxY - 0.1f * m_PlayerScale) continue; // deja dessus (ou au-dessus) : pas de collision laterale
            if (head <= minY) continue;
            if (x > obj.position.x - halfX && x < obj.position.x + halfX &&
                z > obj.position.z - halfZ && z < obj.position.z + halfZ) {
                return true;
            }
        }
        return false;
    }

    void UpdatePlayer(WEngine::Timestep ts, bool uiHasMouse) {
        if (!m_PlayerHasCharacter) return; // pas de "Depart Joueur" : rien a deplacer
        bool freeLook = (m_Play.activeCamera < 0 || m_Play.cameraFollows);
        if (!uiHasMouse && freeLook) {
            m_Camera.OnUpdateLookOnly(ts);
        }

        WEngine::Vec3 fwd = m_Camera.Forward(); fwd.y = 0.0f; fwd = fwd.Normalized();
        WEngine::Vec3 right = m_Camera.Right(); right.y = 0.0f; right = right.Normalized();

        WEngine::Vec3 move{ 0.0f, 0.0f, 0.0f };
        if (!uiHasMouse && !m_PlayerFrozen) {
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

        bool wasGrounded = m_PlayerGrounded;

        // Coyote time + memorisation du saut : le saut part meme si on
        // appuie un peu trop tot ou juste apres avoir quitte le sol.
        bool spaceDown = !uiHasMouse && !m_PlayerFrozen && WEngine::Input::IsKeyPressed(GLFW_KEY_SPACE);
        if (spaceDown && !m_SpaceWasDown) m_JumpBuffer = 0.12f;
        m_SpaceWasDown = spaceDown;
        m_CoyoteTimer = m_PlayerGrounded ? 0.12f : std::fmax(0.0f, m_CoyoteTimer - dt);
        m_JumpBuffer = std::fmax(0.0f, m_JumpBuffer - dt);
        if (m_JumpBuffer > 0.0f && m_CoyoteTimer > 0.0f) {
            m_PlayerVelY = m_Play.jumpForce;
            m_PlayerGrounded = false;
            m_JumpBuffer = 0.0f;
            m_CoyoteTimer = 0.0f;
        }

        if (m_Play.gravity) {
            m_PlayerVelY -= m_Play.gravityForce * dt;
        } else {
            m_PlayerVelY = 0.0f;
        }
        float feetBefore = m_PlayerPos.y - PlayerHalfHeight();
        float headBefore = m_PlayerPos.y + PlayerHalfHeight();
        m_PlayerPos.y += m_PlayerVelY * dt;
        float feetAfter = m_PlayerPos.y - PlayerHalfHeight();
        float ground = SurfaceHeightAt(m_PlayerPos.x, m_PlayerPos.z, feetBefore);
        if (m_Play.gravity && feetAfter <= ground) {
            m_PlayerPos.y = ground + PlayerHalfHeight();
            m_PlayerVelY = 0.0f;
            m_PlayerGrounded = true;
        } else if (m_Play.gravity) {
            m_PlayerGrounded = false;
        }
        if (m_PlayerVelY > 0.0f) {
            // Plafond : cogner la tete contre le dessous d'une plateforme
            // arrete la montee au lieu de continuer dedans.
            float ceiling = CeilingHeightAt(m_PlayerPos.x, m_PlayerPos.z, headBefore);
            float headNow = m_PlayerPos.y + PlayerHalfHeight();
            if (headNow > ceiling) {
                m_PlayerPos.y = ceiling - PlayerHalfHeight();
                m_PlayerVelY = 0.0f;
            }
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
            // La distance de la camera suit la Taille du personnage : sinon
            // un personnage agrandi remplit tout l'ecran (camera "dans sa
            // tete") et un personnage reduit parait minuscule et lointain.
            WEngine::Vec3 camOffset = m_Camera.Forward() * (-5.0f * m_PlayerScale) + WEngine::Vec3(0.0f, 2.0f * m_PlayerScale, 0.0f);
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
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(m_PlayerPos), WEngine::Mat4::RotateY(m_PlayerFacingYaw)),
            WEngine::Mat4::Scale({ m_PlayerScale, m_PlayerScale, m_PlayerScale }));

        // Modele .obj importe (fait dans Blender par ex.) a la place du
        // petit bonhomme procedural, si on en a choisi un dans "Parametres
        // du monde > Personnage".
        if (!m_PlayerModelPath.empty()) {
            WEngine::Mesh* mesh = GetModel(m_PlayerModelPath);
            if (mesh) {
                m_Shader->SetInt(m_LocLit, 1);
                m_Shader->SetInt(m_LocUseTex, 0);
                m_Shader->SetFloat3(m_LocTint, m_PlayerTint.x, m_PlayerTint.y, m_PlayerTint.z);
                m_Shader->SetFloat("u_Metallic", 0.0f);
                m_Shader->SetFloat("u_Roughness", 0.6f);
                m_Shader->SetFloat3("u_Emissive", 0.0f, 0.0f, 0.0f);
                SetModel(base);
                mesh->Draw();
                return;
            }
        }

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

        auto tinted = [&](WEngine::Vec3 c) {
            return WEngine::Vec3(c.x * m_PlayerTint.x, c.y * m_PlayerTint.y, c.z * m_PlayerTint.z);
        };
        WEngine::Vec3 skin = tinted({ 0.95f, 0.8f, 0.65f });
        WEngine::Vec3 shirt = tinted({ 0.3f, 0.55f, 0.9f });
        WEngine::Vec3 pants = tinted({ 0.25f, 0.3f, 0.4f });

        DrawPart(base, { 0.0f, 0.0f, 0.0f }, { 0.5f * squashXZ, 0.95f * squashY, 0.5f * squashXZ }, shirt, m_Cylinder.get());
        DrawPart(base, { 0.0f, 0.78f * squashY + headBob, 0.0f }, { 0.42f, 0.42f, 0.42f }, skin, m_Sphere.get());
        DrawLimb(base, { 0.42f, 0.35f * squashY, 0.0f }, armSwing, 0.65f, 0.16f, shirt);
        DrawLimb(base, { -0.42f, 0.35f * squashY, 0.0f }, -armSwing, 0.65f, 0.16f, shirt);
        DrawLimb(base, { 0.2f, -0.45f * squashY, 0.0f }, -legSwing, 0.75f, 0.2f, pants);
        DrawLimb(base, { -0.2f, -0.45f * squashY, 0.0f }, legSwing, 0.75f, 0.2f, pants);
    }

    // ---- Gizmo de deplacement ----

    // Le gizmo garde la meme taille a l'ecran quelle que soit la distance,
    // comme dans Unreal (avant, il devenait minuscule de loin).
    float GizmoScale(const WEngine::Vec3& pos) const {
        WEngine::Vec3 d = pos - m_Camera.Position;
        return std::max(0.15f, std::sqrt(WEngine::Vec3::Dot(d, d)) / 8.0f);
    }

    WEngine::Vec3 GizmoAxisColor(int axis) const {
        // Axe survole ou tire en jaune, comme dans Unreal.
        bool hot = (m_DraggingAxis == axis) || (m_DraggingAxis < 0 && m_HoverAxis == axis);
        if (hot) return { 1.0f, 0.88f, 0.1f };
        if (axis == 0) return { 0.95f, 0.25f, 0.25f };
        if (axis == 1) return { 0.25f, 0.95f, 0.3f };
        return { 0.3f, 0.45f, 0.95f };
    }

    void DrawGizmo(const SceneObject& obj) {
        const WEngine::Vec3& pos = obj.position;
        float s = GizmoScale(pos);
        m_Shader->SetInt(m_LocLit, 0);
        m_Shader->SetInt(m_LocUseTex, 0);

        if (m_GizmoMode == 1) {
            for (int a = 0; a < 3; a++) DrawRotationRing(pos, a, s, GizmoAxisColor(a));
            return;
        }
        bool scaleMode = (m_GizmoMode == 2);
        DrawAxisHandle(pos, AXIS_X, s, GizmoAxisColor(0), scaleMode);
        DrawAxisHandle(pos, AXIS_Y, s, GizmoAxisColor(1), scaleMode);
        DrawAxisHandle(pos, AXIS_Z, s, GizmoAxisColor(2), scaleMode);
    }

    void DrawRotationRing(const WEngine::Vec3& center, int axis, float s, const WEngine::Vec3& color) {
        // L'anneau est cree dans le plan XZ : on le bascule selon l'axe.
        WEngine::Mat4 orient = WEngine::Mat4::Identity();
        if (axis == 0) orient = WEngine::Mat4::RotateZ(90.0f * DEG2RAD); // autour de X
        else if (axis == 2) orient = WEngine::Mat4::RotateX(90.0f * DEG2RAD); // autour de Z
        float r = GIZMO_LEN * s;
        WEngine::Mat4 model = WEngine::Mat4::Multiply(
            WEngine::Mat4::Multiply(WEngine::Mat4::Translate(center), orient),
            WEngine::Mat4::Scale({ r, r, r }));
        m_Shader->SetFloat3(m_LocTint, color.x, color.y, color.z);
        SetModel(model);
        m_Ring->Draw();
    }

    void DrawAxisHandle(const WEngine::Vec3& origin, const WEngine::Vec3& axis, float s, const WEngine::Vec3& color, bool boxTip) {
        float shaftLen = GIZMO_LEN * 0.7f * s, thick = 0.06f * s;
        float headLen = (boxTip ? 0.22f : GIZMO_LEN * 0.3f) * s;
        float headThick = (boxTip ? 0.22f : 0.16f) * s;

        WEngine::Vec3 shaftScale(
            axis.x != 0.0f ? shaftLen : thick,
            axis.y != 0.0f ? shaftLen : thick,
            axis.z != 0.0f ? shaftLen : thick);
        WEngine::Vec3 shaftPos = origin + axis * (shaftLen * 0.5f);
        WEngine::Mat4 shaftModel = WEngine::Mat4::Multiply(WEngine::Mat4::Translate(shaftPos), WEngine::Mat4::Scale(shaftScale));
        m_Shader->SetFloat3(m_LocTint, color.x, color.y, color.z);
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

    // Distance la plus courte entre le rayon de la souris et un segment.
    static float RaySegmentDistance(const WEngine::Ray& ray, const WEngine::Vec3& a, const WEngine::Vec3& b) {
        WEngine::Vec3 d1 = ray.direction, d2 = b - a, r = ray.origin - a;
        float a11 = WEngine::Vec3::Dot(d1, d1), b12 = WEngine::Vec3::Dot(d1, d2), c22 = WEngine::Vec3::Dot(d2, d2);
        float d = WEngine::Vec3::Dot(d1, r), e = WEngine::Vec3::Dot(d2, r);
        if (a11 < 1e-8f || c22 < 1e-8f) return 1e9f;
        float denom = a11 * c22 - b12 * b12;
        float t = denom > 1e-8f ? (b12 * e - c22 * d) / denom : 0.0f;
        if (t < 0.0f) t = 0.0f;
        float u = (e + t * b12) / c22;
        u = std::min(1.0f, std::max(0.0f, u));
        t = (u * b12 - d) / a11;
        if (t < 0.0f) t = 0.0f;
        WEngine::Vec3 diff = (ray.origin + d1 * t) - (a + d2 * u);
        return std::sqrt(WEngine::Vec3::Dot(diff, diff));
    }

    // Quel axe du gizmo est sous la souris ? (-1 = aucun). Toute la fleche
    // est cliquable, pas seulement sa pointe.
    int HitTestGizmo(const WEngine::Ray& ray) const {
        if (m_GameView || m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return -1;
        const SceneObject& sel = m_Objects[m_Selected];
        if (sel.shape == Shape_Text) return -1;
        const WEngine::Vec3& objPos = sel.position;
        float s = GizmoScale(objPos);
        int bestAxis = -1;
        float best = 1e9f;
        for (int a = 0; a < 3; a++) {
            WEngine::Vec3 dir = (a == 0) ? AXIS_X : (a == 1 ? AXIS_Y : AXIS_Z);
            if (m_GizmoMode == 1) {
                WEngine::Vec3 hit;
                if (!WEngine::RayPlaneIntersect(ray, objPos, dir, hit)) continue;
                WEngine::Vec3 d = hit - objPos;
                float diff = std::fabs(std::sqrt(WEngine::Vec3::Dot(d, d)) - GIZMO_LEN * s);
                if (diff < 0.2f * s && diff < best) { best = diff; bestAxis = a; }
            } else {
                float dist = RaySegmentDistance(ray, objPos + dir * (0.15f * s), objPos + dir * (GIZMO_LEN * s));
                if (dist < 0.16f * s && dist < best) { best = dist; bestAxis = a; }
            }
        }
        return bestAxis;
    }

    bool TryStartGizmoDrag(const WEngine::Ray& ray, float mx, bool duplicate) {
        int axisHit = HitTestGizmo(ray);
        if (axisHit < 0) return false;
        PushUndo();
        if (duplicate) {
            // Alt + glisser une fleche : on deplace une copie, comme dans Unreal.
            SceneObject copy = m_Objects[m_Selected];
            copy.name = MakeUniqueName(copy.name);
            m_Objects.push_back(copy);
            m_Selected = (int)m_Objects.size() - 1;
            SetStatus("Copie : " + copy.name);
        }
        const SceneObject& sel = m_Objects[m_Selected];
        m_DraggingAxis = axisHit;
        m_DragOriginPos = sel.position;
        m_DragStartScale = sel.scale;
        m_DragStartRot = sel.rotationEuler;
        m_DragStartMouseX = mx;
        WEngine::Vec3 axis = axisHit == 0 ? AXIS_X : (axisHit == 1 ? AXIS_Y : AXIS_Z);
        WEngine::Vec3 camFwd = m_Camera.Forward();
        WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
        WEngine::Vec3 hit;
        m_DragStartOffset = 0.0f;
        if (WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) {
            m_DragStartOffset = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis);
        }
        return true;
    }

    void UpdateGizmoDrag(const WEngine::Ray& ray, float mx) {
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
            return;
        }

        WEngine::Vec3 camFwd = m_Camera.Forward();
        WEngine::Vec3 planeNormal = WEngine::Vec3::Cross(axis, WEngine::Vec3::Cross(camFwd, axis)).Normalized();
        WEngine::Vec3 hit;
        if (!WEngine::RayPlaneIntersect(ray, m_DragOriginPos, planeNormal, hit)) return;

        if (m_GizmoMode == 2) {
            float t = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis) - m_DragStartOffset;
            WEngine::Vec3 sc = m_DragStartScale;
            float& target = (m_DraggingAxis == 0) ? sc.x : (m_DraggingAxis == 1 ? sc.y : sc.z);
            target += t;
            if (m_Snap && m_SnapScale > 0.0f) target = std::round(target / m_SnapScale) * m_SnapScale;
            if (target < 0.05f) target = 0.05f;
            sel.scale = sc;
        } else {
            float t = WEngine::Vec3::Dot(hit - m_DragOriginPos, axis);
            WEngine::Vec3 p = m_DragOriginPos + axis * (t - m_DragStartOffset);
            if (m_Snap && m_SnapMove > 0.0f) {
                // Seul l'axe tire est aligne sur la grille : les deux autres
                // gardent leur valeur (avant, ils sautaient aussi sur la grille).
                float& v = (m_DraggingAxis == 0) ? p.x : (m_DraggingAxis == 1 ? p.y : p.z);
                v = std::round(v / m_SnapMove) * m_SnapMove;
            }
            sel.position = p;
        }
    }

    // Selection precise : on teste la vraie boite (ou sphere) de l'objet,
    // tournee et mise a l'echelle, au lieu d'une grosse sphere approximative
    // qui faisait selectionner le mauvais objet.
    bool RayHitsObject(const WEngine::Ray& ray, const SceneObject& o, float& outT) const {
        switch (o.shape) {
            case Shape_Text:        return false;
            case Shape_Camera:      return WEngine::RaySphereIntersect(ray, o.position, 0.45f, outT);
            case Shape_Light:       return WEngine::RaySphereIntersect(ray, o.position, 0.4f, outT);
            case Shape_PlayerStart: return WEngine::RaySphereIntersect(ray, o.position + WEngine::Vec3(0.0f, 0.9f, 0.0f), 0.7f, outT);
            case Shape_Checkpoint:  return WEngine::RaySphereIntersect(ray, o.position + WEngine::Vec3(0.0f, 1.0f, 0.0f), 0.75f, outT);
            default: break;
        }
        WEngine::Mat4 rot = WEngine::Mat4::Multiply(
            WEngine::Mat4::RotateY(m_Time * o.rotationSpeed + o.rotationEuler.y * DEG2RAD),
            WEngine::Mat4::Multiply(
                WEngine::Mat4::RotateX(o.rotationEuler.x * DEG2RAD),
                WEngine::Mat4::RotateZ(o.rotationEuler.z * DEG2RAD)));
        const float* m = rot.m;
        auto toLocal = [&](const WEngine::Vec3& v) {
            return WEngine::Vec3(m[0] * v.x + m[1] * v.y + m[2] * v.z,
                                 m[4] * v.x + m[5] * v.y + m[6] * v.z,
                                 m[8] * v.x + m[9] * v.y + m[10] * v.z);
        };
        WEngine::Vec3 lo = toLocal(ray.origin - o.position), ld = toLocal(ray.direction);
        float sc[3] = { std::max(std::fabs(o.scale.x), 1e-4f), std::max(std::fabs(o.scale.y), 1e-4f), std::max(std::fabs(o.scale.z), 1e-4f) };
        float po[3] = { lo.x / sc[0], lo.y / sc[1], lo.z / sc[2] };
        float pd[3] = { ld.x / sc[0], ld.y / sc[1], ld.z / sc[2] };

        if (o.shape == Shape_Sphere) {
            float a = pd[0] * pd[0] + pd[1] * pd[1] + pd[2] * pd[2];
            float b = 2.0f * (po[0] * pd[0] + po[1] * pd[1] + po[2] * pd[2]);
            float c = po[0] * po[0] + po[1] * po[1] + po[2] * po[2] - 0.25f;
            float disc = b * b - 4.0f * a * c;
            if (a < 1e-12f || disc < 0.0f) return false;
            float sq = std::sqrt(disc);
            float t = (-b - sq) / (2.0f * a);
            if (t < 0.0f) t = (-b + sq) / (2.0f * a);
            if (t < 0.0f) return false;
            outT = t;
            return true;
        }

        float tMin = -1e30f, tMax = 1e30f;
        for (int k = 0; k < 3; k++) {
            if (std::fabs(pd[k]) < 1e-9f) {
                if (po[k] < -0.5f || po[k] > 0.5f) return false;
                continue;
            }
            float t1 = (-0.5f - po[k]) / pd[k], t2 = (0.5f - po[k]) / pd[k];
            if (t1 > t2) std::swap(t1, t2);
            tMin = std::max(tMin, t1);
            tMax = std::min(tMax, t2);
            if (tMin > tMax) return false;
        }
        if (tMax < 0.0f) return false;
        outT = tMin >= 0.0f ? tMin : tMax;
        return true;
    }

    int PickObject(const WEngine::Ray& ray) const {
        float bestT = 1e30f;
        int bestObj = -1;
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (m_Objects[i].destroyed) continue;
            if (m_GameView && (m_Objects[i].shape == Shape_Camera || m_Objects[i].shape == Shape_Light || m_Objects[i].shape == Shape_PlayerStart)) continue;
            float t;
            if (RayHitsObject(ray, m_Objects[i], t) && t < bestT) { bestT = t; bestObj = i; }
        }
        return bestObj;
    }

    static bool AltDown() {
        return WEngine::Input::IsKeyPressed(GLFW_KEY_LEFT_ALT) || WEngine::Input::IsKeyPressed(GLFW_KEY_RIGHT_ALT);
    }

    // Point autour duquel on tourne avec Alt + clic gauche : l'objet
    // selectionne, sinon un point devant la camera.
    WEngine::Vec3 OrbitPivot() const {
        if (m_Selected >= 0 && m_Selected < (int)m_Objects.size()) return m_Objects[m_Selected].position;
        return m_Camera.Position + m_Camera.Forward() * 8.0f;
    }

    // Navigation du viewport calquee sur Unreal (vue perspective) :
    //  - clic droit + souris : regarder, + ZQSD/WASD/Q/E : voler
    //  - clic gauche + glisser dans le vide : avancer/reculer + tourner
    //  - clic gauche + clic droit + glisser : monter/descendre
    //  - clic molette + glisser : deplacer la vue (panoramique)
    //  - Alt + clic gauche : orbiter autour de la selection
    //  - Alt + clic droit : zoomer vers la selection ; Alt + molette : panoramique
    //  - clic gauche sans bouger : selectionner (au relachement)
    void UpdateViewportInput(WEngine::Timestep ts, bool uiHasMouse) {
        auto& window = WEngine::Application::Get().GetWindow();
        auto [mx, my] = WEngine::Input::GetMousePosition();
        (void)window;
        WEngine::Ray ray = m_Camera.ScreenPointToRay(mx - m_ViewX, my - m_ViewY, m_ViewportW, m_ViewportH, FOV_Y);

        bool lmb = WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT);
        bool rmb = WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT);
        bool mmb = WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_MIDDLE);
        bool lmbPressed = lmb && !m_LeftWasDown, rmbPressed = rmb && !m_RightWasDown, mmbPressed = mmb && !m_MiddleWasDown;
        m_LeftWasDown = lmb; m_RightWasDown = rmb; m_MiddleWasDown = mmb;
        float dx = mx - m_NavLastX, dy = my - m_NavLastY;
        m_NavLastX = mx; m_NavLastY = my;
        bool alt = AltDown();

        if (m_DraggingAxis >= 0) {
            if (!lmb || m_Selected < 0 || m_Selected >= (int)m_Objects.size()) m_DraggingAxis = -1;
            else UpdateGizmoDrag(ray, mx);
            m_Camera.ResetLook();
            return;
        }

        if (m_NavMode == Nav_None && !uiHasMouse) {
            if (lmbPressed) {
                if (TryStartGizmoDrag(ray, mx, alt)) { m_HoverAxis = -1; return; }
                if (alt) {
                    WEngine::Vec3 d = OrbitPivot() - m_Camera.Position;
                    m_OrbitDist = std::max(0.5f, std::sqrt(WEngine::Vec3::Dot(d, d)));
                    m_NavMode = Nav_Orbit;
                } else {
                    m_NavMode = Nav_LmbPending;
                    m_NavPressX = mx; m_NavPressY = my;
                }
            } else if (mmbPressed) {
                m_NavMode = Nav_Pan;
            } else if (rmbPressed && alt) {
                m_NavMode = Nav_Dolly;
            }
        }

        const float LOOK = m_Camera.MouseSensitivity;
        const float PAN = 0.01f * std::max(1.0f, m_Camera.MoveSpeed / 6.0f);
        WEngine::Vec3 flatFwd = m_Camera.Forward();
        flatFwd.y = 0.0f;
        if (WEngine::Vec3::Dot(flatFwd, flatFwd) > 1e-6f) flatFwd = flatFwd.Normalized();

        switch (m_NavMode) {
            case Nav_LmbPending:
            case Nav_LmbFly:
                if (!lmb) {
                    if (m_NavMode == Nav_LmbPending) m_Selected = PickObject(ray);
                    m_NavMode = Nav_None;
                    break;
                }
                if (m_NavMode == Nav_LmbPending && std::fabs(mx - m_NavPressX) + std::fabs(my - m_NavPressY) > 4.0f) {
                    m_NavMode = Nav_LmbFly;
                }
                if (m_NavMode == Nav_LmbFly) {
                    if (rmb) {
                        m_Camera.Position.y -= dy * PAN * 2.0f;
                    } else {
                        m_Camera.Yaw += dx * LOOK;
                        m_Camera.Position = m_Camera.Position - flatFwd * (dy * PAN * 3.0f);
                    }
                }
                break;
            case Nav_Orbit:
                if (!lmb) { m_NavMode = Nav_None; break; }
                if (dx != 0.0f || dy != 0.0f) {
                    WEngine::Vec3 pivot = OrbitPivot();
                    m_Camera.Yaw += dx * LOOK * 1.5f;
                    m_Camera.Pitch -= dy * LOOK * 1.5f;
                    if (m_Camera.Pitch > 89.0f) m_Camera.Pitch = 89.0f;
                    if (m_Camera.Pitch < -89.0f) m_Camera.Pitch = -89.0f;
                    m_Camera.Position = pivot - m_Camera.Forward() * m_OrbitDist;
                }
                break;
            case Nav_Pan:
                if (!mmb) { m_NavMode = Nav_None; break; }
                m_Camera.Position = m_Camera.Position + m_Camera.Right() * (dx * PAN * 2.0f) - m_Camera.Up() * (dy * PAN * 2.0f);
                break;
            case Nav_Dolly:
                if (!rmb) { m_NavMode = Nav_None; break; }
                m_Camera.Position = m_Camera.Position + m_Camera.Forward() * ((dx - dy) * PAN * 2.0f);
                break;
            case Nav_None:
            default:
                if (!uiHasMouse && !alt) m_Camera.OnUpdate(ts);
                break;
        }
        if (m_NavMode != Nav_None) m_Camera.ResetLook();

        m_HoverAxis = (m_NavMode == Nav_None && !uiHasMouse && !rmb) ? HitTestGizmo(ray) : -1;
    }

    // Molette : avancer/reculer ; molette + clic droit : vitesse de la camera
    // (les deux comme dans Unreal).
    void HandleViewportWheel() {
        if (m_PlayerMode) return;
        ImGuiIO& io = ImGui::GetIO();
        if (io.MouseWheel == 0.0f || io.WantCaptureMouse) return;
        if (WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)) {
            float f = std::pow(1.25f, io.MouseWheel);
            m_Camera.MoveSpeed = std::min(60.0f, std::max(0.5f, m_Camera.MoveSpeed * f));
            char buf[64];
            snprintf(buf, sizeof(buf), "Vitesse de la camera : %.1f", m_Camera.MoveSpeed);
            SetStatus(buf);
        } else {
            float step = std::max(0.5f, m_Camera.MoveSpeed * 0.15f);
            m_Camera.Position = m_Camera.Position + m_Camera.Forward() * (io.MouseWheel * step);
        }
    }

    // Touche Fin : pose l'objet sur la surface juste en dessous (ou sur la
    // grille s'il n'y a rien), comme "Snap to Floor" dans Unreal.
    void SnapSelectedToFloor() {
        if (m_Selected < 0 || m_Selected >= (int)m_Objects.size()) return;
        SceneObject& o = m_Objects[m_Selected];
        bool solid = (o.shape == Shape_Cube || o.shape == Shape_Sphere || o.shape == Shape_Cylinder || o.shape == Shape_Model);
        float halfH = solid ? std::fabs(o.scale.y) * 0.5f : 0.0f;
        float bottom = o.position.y - halfH;
        float halfX = solid ? std::fabs(o.scale.x) * 0.5f : 0.05f;
        float halfZ = solid ? std::fabs(o.scale.z) * 0.5f : 0.05f;
        float floorY = 0.0f;
        bool found = false;
        for (int i = 0; i < (int)m_Objects.size(); i++) {
            if (i == m_Selected) continue;
            const SceneObject& other = m_Objects[i];
            bool otherSolid = (other.shape == Shape_Cube || other.shape == Shape_Sphere || other.shape == Shape_Cylinder || other.shape == Shape_Model);
            if (!otherSolid || other.destroyed) continue;
            float ohx = std::fabs(other.scale.x) * 0.5f, ohz = std::fabs(other.scale.z) * 0.5f;
            if (o.position.x + halfX <= other.position.x - ohx || o.position.x - halfX >= other.position.x + ohx) continue;
            if (o.position.z + halfZ <= other.position.z - ohz || o.position.z - halfZ >= other.position.z + ohz) continue;
            float top = other.position.y + std::fabs(other.scale.y) * 0.5f;
            if (top <= bottom + 0.001f && (!found || top > floorY)) { floorY = top; found = true; }
        }
        if (!found && bottom < 0.0f) { SetStatus("Rien en dessous"); return; }
        PushUndo();
        o.position.y = floorY + halfH;
        SetStatus("Pose au sol");
    }

    // ================= Interface ======================================

    void OnImGuiRender() override {
        if (m_ClearUiFocus) {
            // En jeu, le clavier va au jeu : sinon Espace (sauter) "cliquait"
            // aussi le dernier bouton de l'interface, par ex. Arreter.
            ImGui::SetWindowFocus(nullptr);
            m_ClearUiFocus = false;
        }
        HandleViewportWheel();

        DrawToolbar();
        DrawOutliner();
        DrawDetails();
        DrawContentBrowser();
        DrawWorldSettings();

        m_BpWindowFocused = false;
        if (m_ShowScriptEditor && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            DrawBlueprintEditor(m_Objects[m_ScriptTarget]);
        }

        DrawStatsPanel();
        DrawWorldOverlay();

        // Historique : une entree par geste termine (voir PushUndo).
        bool mouseDown = WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT)
                      || WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)
                      || WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_MIDDLE);
        bool interacting = ImGui::IsAnyItemActive() || mouseDown || m_DraggingAxis >= 0;
        if (m_WasInteracting && !interacting) m_UndoCheckNeeded = true;
        m_WasInteracting = interacting;
        if (!interacting && m_UndoCheckNeeded && !m_PlayerMode) {
            CommitUndoIfChanged();
            m_UndoCheckNeeded = false;
        }
    }

    // Barre d'outils en haut, comme dans Unreal : le bouton Jouer y vit.
    void DrawToolbar() {
        ImGui::Begin("Barre d'outils");
        ImVec4 col = m_PlayerMode ? ImVec4(0.72f, 0.18f, 0.18f, 1.0f) : ImVec4(0.14f, 0.52f, 0.20f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, col);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(col.x * 1.25f, col.y * 1.25f, col.z * 1.25f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, col);
        if (ImGui::Button(m_PlayerMode ? "Arreter (Echap)" : "Jouer (Alt+P)", ImVec2(130, 28))) TogglePlay();
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
            ImGui::TextDisabled("Ctrl+Z annuler, Alt+P jouer, F cadrer, Alt+clic orbite, clic droit + WASD voler");
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
            if (ImGui::Selectable(label.c_str(), selected, ImGuiSelectableFlags_AllowDoubleClick)) {
                m_Selected = i;
                // Double-clic : la vue se centre sur l'objet, comme dans Unreal.
                if (ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left) && !m_PlayerMode) FocusSelected();
            }
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
            if (m_NewShape == Shape_Camera || m_NewShape == Shape_Text || m_NewShape == Shape_Light || m_NewShape == Shape_PlayerStart) obj.collision = false;
            // Un Point de passage garde collision = true : ca ne le rend pas
            // solide (Shape_Checkpoint est deja exclu de CollidesAt etc.),
            // mais PlayerTouches() s'appuie sur ce meme booleen pour savoir
            // si l'objet peut declencher un evenement au contact.
            if (m_NewShape == Shape_Light) obj.tint = { 1.0f, 0.92f, 0.75f }; // blanc chaud par defaut
            if (m_NewShape == Shape_PlayerStart || m_NewShape == Shape_Checkpoint) obj.position.y = 0.0f;
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
            if (obj.shape == Shape_Camera || obj.shape == Shape_PlayerStart || obj.shape == Shape_Checkpoint) {
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

        if (obj.shape == Shape_PlayerStart) {
            if (ImGui::CollapsingHeader("Depart Joueur", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::TextWrapped("C'est ici que le personnage apparait quand tu appuies sur Jouer (F5). "
                                   "La rotation Y donne la direction dans laquelle il regarde en arrivant. "
                                   "S'il n'y a aucun \"Depart Joueur\" dans la scene, le jeu se lance sans "
                                   "personnage controlable (utile pour une scene juste filmee par une camera).");
            }
        }

        if (obj.shape == Shape_Checkpoint) {
            if (ImGui::CollapsingHeader("Point de passage", ImGuiTreeNodeFlags_DefaultOpen)) {
                ImGui::TextWrapped("Quand le joueur le touche en jeu (bloc \"Activer ce point de "
                                   "passage\" dans son Blueprint), son point de reapparition change : "
                                   "apres une chute ou un \"Renvoyer le joueur au depart\", il repart "
                                   "d'ici au lieu du \"Depart Joueur\" d'origine.");
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
            ImGui::DragFloat("Force de saut", &m_Play.jumpForce, 0.2f, 1.0f, 30.0f);
            ImGui::TextDisabled("Ces valeurs peuvent aussi etre changees par des blocs Blueprint.");
        }
        if (ImGui::CollapsingHeader("Personnage", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::TextWrapped("A quoi ressemble le joueur pendant la partie (visible avec F5).");
            ImGui::ColorEdit3("Couleur", &m_PlayerTint.x);
            ImGui::DragFloat("Taille", &m_PlayerScale, 0.02f, 0.2f, 4.0f);
            ImGui::Separator();
            ImGui::TextDisabled("Modele 3D (sinon le petit bonhomme par defaut) :");
            bool none = m_PlayerModelPath.empty();
            if (ImGui::Selectable("Aucun (bonhomme par defaut)", none)) m_PlayerModelPath.clear();
            if (m_AvailableModels.empty()) {
                ImGui::TextDisabled("Aucun .obj dans /assets.");
                ImGui::TextWrapped("Dans Blender : Fichier > Exporter > Wavefront (.obj), enregistre "
                                   "le fichier dans le dossier assets/ a cote de WEngine.exe, puis "
                                   "clique Rafraichir dans le Navigateur de contenu.");
            } else {
                for (auto& path : m_AvailableModels) {
                    std::string label = fs::path(path).filename().string();
                    if (ImGui::Selectable(label.c_str(), m_PlayerModelPath == path)) m_PlayerModelPath = path;
                }
            }
        }
        ImGui::End();
    }

    void DrawStatsPanel() {
        ImGui::Begin("Statistiques");
        ImGui::Text("FPS : %.0f", m_LastFrameTime > 0.0f ? 1.0f / m_LastFrameTime : 0.0f);
        ImGui::Text("Objets : %d", (int)m_Objects.size());
        ImGui::Text("Camera : %.1f, %.1f, %.1f", m_Camera.Position.x, m_Camera.Position.y, m_Camera.Position.z);
        ImGui::Separator();
        ImGui::TextDisabled("Commandes (les memes que dans Unreal) :");
        ImGui::TextWrapped("Clic gauche : selectionner  |  Clic gauche + glisser dans le vide : avancer/tourner");
        ImGui::TextWrapped("Clic droit + souris : regarder  |  + WASD/ZQSD : voler, Q/E : descendre/monter, molette : vitesse");
        ImGui::TextWrapped("Molette : avancer/reculer  |  Clic molette + glisser : deplacer la vue");
        ImGui::TextWrapped("Alt + clic gauche : tourner autour de la selection  |  Alt + clic droit : zoom");
        ImGui::TextWrapped("W / E / R ou Espace : Deplacer / Tourner / Redimensionner  |  Alt + glisser une fleche : copier");
        ImGui::TextWrapped("F : cadrer la selection  |  Fin : poser au sol  |  G : vue jeu  |  Suppr : supprimer");
        ImGui::TextWrapped("Ctrl+Z / Ctrl+Y : annuler / retablir (tout, y compris Details et Blueprint)");
        ImGui::TextWrapped("N : ouvrir le Blueprint  |  Alt+P ou F5 : jouer  |  Echap : arreter le jeu");
        ImGui::End();
    }

    // Labels "Texte" du monde 3D + HUD du jeu, dessines par-dessus tout.
    void DrawWorldOverlay() {
        // Dessine dans le viewport seulement (derriere les panneaux) : avant,
        // les textes 3D et le HUD passaient par-dessus les fenetres.
        ImDrawList* fg = ImGui::GetBackgroundDrawList();
        fg->PushClipRect(ImVec2(m_ViewX, m_ViewY), ImVec2(m_ViewX + m_ViewportW, m_ViewY + m_ViewportH), true);
        DrawWorldOverlayContent(fg);
        fg->PopClipRect();
    }

    void DrawWorldOverlayContent(ImDrawList* fg) {

        if (m_NoViewInPlay) {
            const char* msg1 = "Aucune vue de jeu";
            const char* msg2 = "Ajoute un \"Depart Joueur\" (personnage) ou active une Camera";
            const char* msg3 = "avec un bloc Blueprint \"Activer cette camera\" pour lancer le jeu.";
            ImVec2 s1 = ImGui::CalcTextSize(msg1), s2 = ImGui::CalcTextSize(msg2), s3 = ImGui::CalcTextSize(msg3);
            float cx = m_ViewX + m_ViewportW * 0.5f, cy = m_ViewY + m_ViewportH * 0.5f;
            fg->AddText(nullptr, 30.0f, ImVec2(cx - s1.x * 0.5f, cy - 40.0f), IM_COL32(255, 90, 90, 255), msg1);
            fg->AddText(nullptr, 18.0f, ImVec2(cx - s2.x * 0.5f, cy + 4.0f), IM_COL32(220, 220, 220, 255), msg2);
            fg->AddText(nullptr, 18.0f, ImVec2(cx - s3.x * 0.5f, cy + 26.0f), IM_COL32(220, 220, 220, 255), msg3);
            return;
        }

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
        float x = m_ViewX + m_ViewportW * 0.5f - 60.0f, y = m_ViewY + 14.0f;
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
            float wx = m_ViewX + m_ViewportW * 0.5f - sz.x * 1.2f;
            float wy = m_ViewY + m_ViewportH * 0.35f;
            fg->AddText(nullptr, 44.0f, ImVec2(wx + 2, wy + 2), IM_COL32(0, 0, 0, 220), wonText);
            fg->AddText(nullptr, 44.0f, ImVec2(wx, wy), IM_COL32(120, 255, 140, 255), wonText);
        }

        // Messages en haut a gauche du viewport, comme le "Print String"
        // d'Unreal (au centre, ils se melangeaient aux textes 3D).
        float mx = m_ViewX + 12.0f, my = m_ViewY + 10.0f;
        for (auto& msg : m_Play.messages) {
            int alpha = (int)(255.0f * Clamp01(msg.timeLeft / 1.5f));
            fg->AddText(nullptr, 20.0f, ImVec2(mx + 1, my + 1), IM_COL32(0, 0, 0, alpha), msg.text.c_str());
            fg->AddText(nullptr, 20.0f, ImVec2(mx, my), IM_COL32(120, 220, 255, alpha), msg.text.c_str());
            my += 24.0f;
        }
    }

    void OnEvent(WEngine::Event& event) override {
        if (event.GetEventType() != WEngine::EventType::KeyPressed) return;
        auto& e = static_cast<WEngine::KeyPressedEvent&>(event);
        constexpr int KEY_ESCAPE = 256;
        constexpr int KEY_DELETE = 261;
        constexpr int KEY_N = 78;
        constexpr int KEY_P = 80;
        constexpr int KEY_F5 = 294;
        bool typing = ImGui::GetIO().WantTextInput;
        m_UndoCheckNeeded = true;

        // Echap arrete le jeu (comme le PIE d'Unreal) ou deselectionne. Avant,
        // Echap FERMAIT l'editeur sans rien demander : tout le travail non
        // sauvegarde etait perdu.
        if (e.GetKeyCode() == KEY_ESCAPE) {
            if (typing || e.IsRepeat()) return;
            if (m_PlayerMode) { StopPlay(); return; }
            m_Selected = -1;
            return;
        }
        bool altKey = AltDown();
        if ((e.GetKeyCode() == KEY_F5 || (altKey && e.GetKeyCode() == KEY_P)) && !e.IsRepeat()) {
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

        if (ctrl) return;

        // Dans l'editeur de Blueprint, Suppr efface le bloc selectionne.
        if (key == KEY_DELETE && m_BpWindowFocused && m_ShowScriptEditor
            && m_ScriptTarget >= 0 && m_ScriptTarget < (int)m_Objects.size()) {
            auto& bp = m_Objects[m_ScriptTarget].blueprint;
            if (m_SelectedNode >= 0 && m_SelectedNode < (int)bp.size()) {
                RemoveNode(bp, m_SelectedNode);
                m_SelectedNode = -1;
            }
            return;
        }

        // W/E/R changent d'outil (la navigation WASD demande le clic droit).
        constexpr int KEY_G = 71, KEY_END = 269, KEY_SPACE = 32;
        bool rmbHeld = WEngine::Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT);
        if (!rmbHeld) {
            if (key == KEY_W) { m_GizmoMode = 0; SetStatus("Outil : Deplacer"); return; }
            if (key == KEY_E) { m_GizmoMode = 1; SetStatus("Outil : Tourner"); return; }
            if (key == KEY_R) { m_GizmoMode = 2; SetStatus("Outil : Redimensionner"); return; }
            // Espace fait tourner les outils Deplacer > Tourner > Redimensionner.
            if (key == KEY_SPACE && !ImGui::GetIO().WantCaptureKeyboard) {
                m_GizmoMode = (m_GizmoMode + 1) % 3;
                const char* names[3] = { "Deplacer", "Tourner", "Redimensionner" };
                SetStatus(std::string("Outil : ") + names[m_GizmoMode]);
                return;
            }
        }
        if (key == KEY_F) { FocusSelected(); return; }
        if (key == KEY_G) {
            m_GameView = !m_GameView;
            SetStatus(m_GameView ? "Vue jeu (G) : reperes d'edition caches" : "Vue editeur (G)");
            return;
        }
        if (key == KEY_END) { SnapSelectedToFloor(); return; }

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
        m_BpScroll = ImVec2(0.0f, 0.0f);
        m_BpZoom = 1.0f;
        m_BpDragNode = -1;
        m_BpLinkDragNode = -1;
        m_BpRmbActive = false;
        m_BpFitRequest = true;
    }

    // Cadre tous les blocs dans la zone visible (a l'ouverture et avec
    // "Recentrer"), sinon une longue chaine sortait de l'ecran.
    void FitBlueprintView(const std::vector<BlueprintNode>& bp, ImVec2 size) {
        m_BpZoom = 1.0f;
        m_BpScroll = ImVec2(0.0f, 0.0f);
        if (bp.empty()) return;
        float minX = 1e9f, minY = 1e9f, maxX = -1e9f, maxY = -1e9f;
        for (const auto& n : bp) {
            minX = std::min(minX, n.pos.x); minY = std::min(minY, n.pos.y);
            maxX = std::max(maxX, n.pos.x + NodeWidth(n)); maxY = std::max(maxY, n.pos.y + BP_NODE_H);
        }
        float w = maxX - minX + 80.0f, h = maxY - minY + 80.0f;
        float fit = std::min(size.x / w, size.y / h);
        m_BpZoom = std::min(1.0f, std::max(0.65f, fit));
        if (fit >= 0.65f) {
            m_BpScroll = ImVec2((size.x - (maxX - minX) * m_BpZoom) * 0.5f - minX * m_BpZoom,
                                (size.y - (maxY - minY) * m_BpZoom) * 0.5f - minY * m_BpZoom);
        } else {
            // Trop grand meme dezoome : on montre le debut (en haut a gauche),
            // le reste se voit en deplacant la vue (clic droit + glisser).
            m_BpScroll = ImVec2(30.0f - minX * m_BpZoom, 30.0f - minY * m_BpZoom);
        }
    }

    // ================= Editeur de Blueprint (graphe facon Unreal) =========
    // Chaque bloc a une broche d'entree blanche a gauche et une (ou deux,
    // pour une condition : Vrai / Faux) broche de sortie a droite. Les fils
    // decident de l'ordre d'execution, comme dans Unreal.

    static const char* NodeTitle(const BlueprintNode& n) {
        const char* label = NODE_TYPES[n.type].label;
        const char* sep = std::strstr(label, " : ");
        return sep ? sep + 3 : label;
    }

    float NodeWidth(const BlueprintNode& n) const {
        float extra = (NodeCategory(n) == Cat_Condition) ? 100.0f : 64.0f;
        return std::max(BP_NODE_W, ImGui::CalcTextSize(NodeTitle(n)).x + extra);
    }

    ImVec2 BpToScreen(const ImVec2& p) const {
        return ImVec2(m_BpOrigin.x + m_BpScroll.x + p.x * m_BpZoom, m_BpOrigin.y + m_BpScroll.y + p.y * m_BpZoom);
    }
    ImVec2 BpToCanvas(const ImVec2& s) const {
        return ImVec2((s.x - m_BpOrigin.x - m_BpScroll.x) / m_BpZoom, (s.y - m_BpOrigin.y - m_BpScroll.y) / m_BpZoom);
    }
    ImVec2 InPinPos(const BlueprintNode& n) const {
        return BpToScreen(ImVec2(n.pos.x + 12.0f, n.pos.y + BP_HEADER_H * 0.5f));
    }
    ImVec2 OutPinPos(const BlueprintNode& n, int pin) const {
        float y = (pin == 0) ? BP_HEADER_H * 0.5f : BP_HEADER_H + 28.0f;
        return BpToScreen(ImVec2(n.pos.x + NodeWidth(n) - 12.0f, n.pos.y + y));
    }

    static void DrawExecPin(ImDrawList* dl, ImVec2 c, float z, bool filled, ImU32 col) {
        ImVec2 pts[5] = {
            ImVec2(c.x - 5.0f * z, c.y - 6.0f * z), ImVec2(c.x + 1.0f * z, c.y - 6.0f * z), ImVec2(c.x + 6.0f * z, c.y),
            ImVec2(c.x + 1.0f * z, c.y + 6.0f * z), ImVec2(c.x - 5.0f * z, c.y + 6.0f * z) };
        if (filled) dl->AddConvexPolyFilled(pts, 5, col);
        else dl->AddPolyline(pts, 5, col, ImDrawFlags_Closed, 1.6f * z);
    }

    static void DrawWire(ImDrawList* dl, ImVec2 a, ImVec2 b, float z, ImU32 col) {
        float dx = std::max(40.0f * z, std::fabs(b.x - a.x) * 0.5f);
        dl->AddBezierCubic(a, ImVec2(a.x + dx, a.y), ImVec2(b.x - dx, b.y), b, col, 3.0f * z);
    }

    int& LinkRef(BlueprintNode& n, int pin) { return pin == 0 ? n.next : n.nextFalse; }

    void AddNodeAt(SceneObject& obj, int type, ImVec2 canvasPos, int linkFrom, int linkPin) {
        BlueprintNode n;
        n.type = type;
        n.pos = canvasPos;
        obj.blueprint.push_back(n);
        int idx = (int)obj.blueprint.size() - 1;
        if (linkFrom >= 0 && linkFrom < idx && NODE_TYPES[type].category != Cat_Event) {
            LinkRef(obj.blueprint[linkFrom], linkPin) = idx;
        }
        m_SelectedNode = idx;
    }

    void OpenAddMenu(ImVec2 canvasPos, int linkFrom, int linkPin) {
        m_BpMenuPos = canvasPos;
        m_BpMenuLinkFrom = linkFrom;
        m_BpMenuLinkPin = linkPin;
        m_BpMenuRequest = true;
    }

    void DrawBlueprintEditor(SceneObject& obj) {
        std::string title = "Blueprint - " + obj.name + "###BlueprintEditor";
        ImGui::SetNextWindowSize(ImVec2(900, 600), ImGuiCond_FirstUseEver);
        if (!ImGui::Begin(title.c_str(), &m_ShowScriptEditor)) { ImGui::End(); return; }
        m_BpWindowFocused = ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows);
        auto& bp = obj.blueprint;
        if (m_SelectedNode >= (int)bp.size()) m_SelectedNode = -1;

        if (ImGui::Button("+ Ajouter un bloc")) {
            // Si un bloc est selectionne et que sa sortie est libre, le
            // nouveau bloc se branche derriere lui automatiquement.
            int from = -1, pin = 0;
            ImVec2 pos = BpToCanvas(ImVec2(m_BpOrigin.x + 60.0f, m_BpOrigin.y + 60.0f));
            if (m_SelectedNode >= 0) {
                BlueprintNode& sel = bp[m_SelectedNode];
                if (sel.next < 0) from = m_SelectedNode;
                else if (NodeCategory(sel) == Cat_Condition && sel.nextFalse < 0) { from = m_SelectedNode; pin = 1; }
                pos = ImVec2(sel.pos.x + NodeWidth(sel) + 60.0f, sel.pos.y + (pin == 1 ? 90.0f : 0.0f));
            }
            OpenAddMenu(pos, from, pin);
        }
        ImGui::SameLine();
        if (ImGui::Button("Charger un exemple")) {
            obj.blueprint = DefaultBlueprint(obj.shape);
            m_SelectedNode = -1;
            m_BpFitRequest = true;
        }
        ImGui::SameLine();
        if (ImGui::Button("Ranger les blocs")) {
            LayoutChains(bp);
            m_BpFitRequest = true;
        }
        ImGui::SameLine();
        if (ImGui::Button("Recentrer")) m_BpFitRequest = true;
        ImGui::TextDisabled("Clic droit : ajouter un bloc  |  Tirer une broche blanche : relier  |  Alt+clic sur une broche : couper  |  "
                            "Clic droit + glisser : deplacer la vue  |  Molette : zoom  |  Suppr : effacer le bloc");

        const float detailsHeight = 100.0f;
        float canvasH = std::max(140.0f, ImGui::GetContentRegionAvail().y - detailsHeight);
        ImGui::BeginChild("##bp_canvas", ImVec2(0, canvasH), true,
            ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoMove);

        ImVec2 origin = ImGui::GetCursorScreenPos();
        ImVec2 size = ImGui::GetContentRegionAvail();
        if (size.x < 50.0f) size.x = 50.0f;
        if (size.y < 50.0f) size.y = 50.0f;
        m_BpOrigin = origin;
        if (m_BpFitRequest) { FitBlueprintView(bp, size); m_BpFitRequest = false; }
        ImGui::InvisibleButton("##bp_canvas_btn", size, ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight);
        bool hovered = ImGui::IsItemHovered();
        ImGuiIO& io = ImGui::GetIO();
        ImVec2 mouse = io.MousePos;
        ImVec2 end(origin.x + size.x, origin.y + size.y);
        bool mouseInCanvas = mouse.x >= origin.x && mouse.x <= end.x && mouse.y >= origin.y && mouse.y <= end.y;
        const float z = m_BpZoom;
        int count = (int)bp.size();

        // ---- Tests de survol -------------------------------------------
        auto nodeAt = [&](ImVec2 p) -> int {
            for (int i = count - 1; i >= 0; i--) {
                ImVec2 mn = BpToScreen(bp[i].pos);
                ImVec2 mx(mn.x + NodeWidth(bp[i]) * z, mn.y + BP_NODE_H * z);
                if (p.x >= mn.x && p.x <= mx.x && p.y >= mn.y && p.y <= mx.y) return i;
            }
            return -1;
        };
        auto nearPin = [&](ImVec2 a, ImVec2 b) {
            float dx = a.x - b.x, dy = a.y - b.y;
            return dx * dx + dy * dy <= (11.0f * z) * (11.0f * z);
        };
        auto outPinAt = [&](ImVec2 p, int& pinOut) -> int {
            for (int i = count - 1; i >= 0; i--) {
                if (nearPin(p, OutPinPos(bp[i], 0))) { pinOut = 0; return i; }
                if (NodeCategory(bp[i]) == Cat_Condition && nearPin(p, OutPinPos(bp[i], 1))) { pinOut = 1; return i; }
            }
            return -1;
        };
        auto inPinAt = [&](ImVec2 p) -> int {
            for (int i = count - 1; i >= 0; i--) {
                if (NodeCategory(bp[i]) != Cat_Event && nearPin(p, InPinPos(bp[i]))) return i;
            }
            return -1;
        };

        // ---- Zoom a la molette, centre sur la souris -----------------------
        if (hovered && io.MouseWheel != 0.0f) {
            float newZoom = std::min(1.6f, std::max(0.4f, m_BpZoom * std::pow(1.1f, io.MouseWheel)));
            ImVec2 cp = BpToCanvas(mouse);
            m_BpZoom = newZoom;
            m_BpScroll = ImVec2(mouse.x - origin.x - cp.x * newZoom, mouse.y - origin.y - cp.y * newZoom);
        }

        // ---- Clic gauche : broche (relier / couper), bloc (selection) ----
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            int pin = 0;
            int n = outPinAt(mouse, pin);
            if (n >= 0) {
                if (io.KeyAlt) LinkRef(bp[n], pin) = -1;
                else { m_BpLinkDragNode = n; m_BpLinkDragPin = pin; }
                m_SelectedNode = n;
            } else if ((n = inPinAt(mouse)) >= 0 && io.KeyAlt) {
                for (auto& other : bp) {
                    if (other.next == n) other.next = -1;
                    if (other.nextFalse == n) other.nextFalse = -1;
                }
                m_SelectedNode = n;
            } else if ((n = nodeAt(mouse)) >= 0) {
                m_SelectedNode = n;
                m_BpDragNode = n;
            } else {
                m_SelectedNode = -1;
            }
        }
        if (m_BpDragNode >= 0) {
            if (!ImGui::IsMouseDown(ImGuiMouseButton_Left) || m_BpDragNode >= count) m_BpDragNode = -1;
            else {
                bp[m_BpDragNode].pos.x += io.MouseDelta.x / z;
                bp[m_BpDragNode].pos.y += io.MouseDelta.y / z;
            }
        }
        if (m_BpLinkDragNode >= 0 && !ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
            int from = m_BpLinkDragNode, pin = m_BpLinkDragPin;
            m_BpLinkDragNode = -1;
            if (from < count) {
                int target = inPinAt(mouse);
                if (target < 0) target = nodeAt(mouse);
                if (target >= 0) {
                    if (target != from && NodeCategory(bp[target]) != Cat_Event) LinkRef(bp[from], pin) = target;
                } else if (mouseInCanvas) {
                    // Comme Unreal : lacher un fil dans le vide ouvre la liste
                    // des blocs, et le bloc choisi arrive deja relie.
                    ImVec2 cp = BpToCanvas(mouse);
                    OpenAddMenu(ImVec2(cp.x - 12.0f, cp.y - BP_HEADER_H * 0.5f), from, pin);
                }
            }
        }

        // ---- Clic droit : menu (clic simple) ou deplacer la vue (glisser) --
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Right)) {
            m_BpRmbActive = true;
            m_BpRmbMoved = 0.0f;
        }
        if (m_BpRmbActive) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Right)) {
                m_BpScroll.x += io.MouseDelta.x;
                m_BpScroll.y += io.MouseDelta.y;
                m_BpRmbMoved += std::fabs(io.MouseDelta.x) + std::fabs(io.MouseDelta.y);
            } else {
                m_BpRmbActive = false;
                if (m_BpRmbMoved < 5.0f && mouseInCanvas) {
                    int n = nodeAt(mouse);
                    if (n >= 0) {
                        m_SelectedNode = n;
                        m_BpContextNode = n;
                        ImGui::OpenPopup("##bp_node_ctx");
                    } else {
                        OpenAddMenu(BpToCanvas(mouse), -1, 0);
                    }
                }
            }
        }

        // ---- Dessin ------------------------------------------------------
        ImDrawList* dl = ImGui::GetWindowDrawList();
        dl->PushClipRect(origin, end, true);
        dl->AddRectFilled(origin, end, IM_COL32(38, 38, 38, 255));
        float step = 16.0f * z;
        if (step >= 6.0f) {
            float startX = std::fmod(m_BpScroll.x, step); if (startX < 0.0f) startX += step;
            float startY = std::fmod(m_BpScroll.y, step); if (startY < 0.0f) startY += step;
            for (float x = startX; x < size.x; x += step) {
                int idx = (int)std::lround((x - m_BpScroll.x) / step);
                dl->AddLine(ImVec2(origin.x + x, origin.y), ImVec2(origin.x + x, end.y), idx % 8 == 0 ? IM_COL32(22, 22, 22, 255) : IM_COL32(48, 48, 48, 255));
            }
            for (float y = startY; y < size.y; y += step) {
                int idx = (int)std::lround((y - m_BpScroll.y) / step);
                dl->AddLine(ImVec2(origin.x, origin.y + y), ImVec2(end.x, origin.y + y), idx % 8 == 0 ? IM_COL32(22, 22, 22, 255) : IM_COL32(48, 48, 48, 255));
            }
        }
        if (bp.empty()) {
            const char* hint = "Clic droit ici pour ajouter un bloc (commence par un Evenement, ex : Debut du jeu)";
            ImVec2 ts = ImGui::CalcTextSize(hint);
            dl->AddText(ImVec2(origin.x + (size.x - ts.x) * 0.5f, origin.y + size.y * 0.45f), IM_COL32(150, 150, 150, 255), hint);
        }

        std::vector<bool> hasInput(count, false);
        for (int i = 0; i < count; i++) {
            for (int pin = 0; pin < 2; pin++) {
                int target = pin == 0 ? bp[i].next : bp[i].nextFalse;
                if (target < 0 || target >= count) continue;
                hasInput[target] = true;
                bool hot = (i == m_SelectedNode || target == m_SelectedNode);
                DrawWire(dl, OutPinPos(bp[i], pin), InPinPos(bp[target]), z, hot ? IM_COL32(255, 255, 255, 255) : IM_COL32(215, 215, 215, 220));
            }
        }
        if (m_BpLinkDragNode >= 0 && m_BpLinkDragNode < count) {
            DrawWire(dl, OutPinPos(bp[m_BpLinkDragNode], m_BpLinkDragPin), mouse, z, IM_COL32(255, 255, 255, 255));
        }

        ImFont* font = ImGui::GetFont();
        float fontSize = ImGui::GetFontSize() * z;
        for (int i = 0; i < count; i++) {
            BlueprintNode& node = bp[i];
            const NodeTypeInfo& info = NODE_TYPES[node.type];
            int cat = info.category;
            ImVec2 mn = BpToScreen(node.pos);
            ImVec2 mx(mn.x + NodeWidth(node) * z, mn.y + BP_NODE_H * z);
            float headerBottom = mn.y + BP_HEADER_H * z;

            dl->AddRectFilled(ImVec2(mn.x + 3 * z, mn.y + 4 * z), ImVec2(mx.x + 3 * z, mx.y + 4 * z), IM_COL32(0, 0, 0, 90), 7.0f * z);
            dl->AddRectFilled(mn, mx, IM_COL32(22, 22, 24, 240), 7.0f * z);
            dl->AddRectFilled(mn, ImVec2(mx.x, headerBottom), info.color, 7.0f * z, ImDrawFlags_RoundCornersTop);
            bool selected = (i == m_SelectedNode);
            dl->AddRect(mn, mx, selected ? IM_COL32(245, 165, 35, 255) : IM_COL32(0, 0, 0, 200), 7.0f * z, 0, selected ? 2.5f : 1.0f);

            int r = (info.color >> IM_COL32_R_SHIFT) & 0xFF, g = (info.color >> IM_COL32_G_SHIFT) & 0xFF, b = (info.color >> IM_COL32_B_SHIFT) & 0xFF;
            bool lightHeader = (r * 299 + g * 587 + b * 114) / 1000 > 150;
            ImU32 titleCol = lightHeader ? IM_COL32(20, 20, 20, 255) : IM_COL32(255, 255, 255, 255);
            dl->AddText(font, fontSize, ImVec2(mn.x + 24.0f * z, mn.y + (BP_HEADER_H * z - fontSize) * 0.5f), titleCol, NodeTitle(node));

            std::string sub = NodeSummary(node);
            if (!sub.empty()) {
                dl->AddText(font, fontSize, ImVec2(mn.x + 12.0f * z, headerBottom + 8.0f * z), IM_COL32(200, 200, 200, 255), sub.c_str());
            }

            if (cat != Cat_Event) DrawExecPin(dl, InPinPos(node), z, hasInput[i], IM_COL32(255, 255, 255, 255));
            ImVec2 out0 = OutPinPos(node, 0);
            DrawExecPin(dl, out0, z, node.next >= 0, IM_COL32(255, 255, 255, 255));
            if (cat == Cat_Condition) {
                ImVec2 out1 = OutPinPos(node, 1);
                DrawExecPin(dl, out1, z, node.nextFalse >= 0, IM_COL32(255, 255, 255, 255));
                float vw = ImGui::CalcTextSize("Vrai").x * z, fw = ImGui::CalcTextSize("Faux").x * z;
                dl->AddText(font, fontSize, ImVec2(out0.x - 12.0f * z - vw, out0.y - fontSize * 0.5f), titleCol, "Vrai");
                dl->AddText(font, fontSize, ImVec2(out1.x - 12.0f * z - fw, out1.y - fontSize * 0.5f), IM_COL32(230, 230, 230, 255), "Faux");
            }
        }
        dl->PopClipRect();

        // ---- Menus ------------------------------------------------------
        if (m_BpMenuRequest) {
            ImGui::OpenPopup("##bp_add");
            m_BpMenuRequest = false;
        }
        if (ImGui::BeginPopup("##bp_add")) {
            bool linking = (m_BpMenuLinkFrom >= 0 && m_BpMenuLinkFrom < count);
            ImGui::TextDisabled(linking ? "Bloc a relier au fil" : "Toutes les actions pour ce Blueprint");
            if (ImGui::IsWindowAppearing()) {
                m_BpSearch.clear();
                ImGui::SetKeyboardFocusHere();
            }
            ImGui::SetNextItemWidth(360.0f);
            bool enter = ImGui::InputTextWithHint("##bpsearch", "Rechercher...", (char*)m_BpSearch.c_str(), m_BpSearch.capacity() + 1,
                ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_CallbackResize, TextEditCallback, &m_BpSearch);
            int created = -1, firstMatch = -1;
            ImGui::BeginChild("##bp_add_list", ImVec2(360.0f, 340.0f));
            for (int c = 0; c < 4; c++) {
                if (linking && c == Cat_Event) continue; // un evenement n'a pas d'entree
                bool header = false;
                for (int t = 0; t < NODE_TYPE_COUNT; t++) {
                    if (NODE_TYPES[t].category != c) continue;
                    if (!m_BpSearch.empty() && !NameMatches(NODE_TYPES[t].label, m_BpSearch)) continue;
                    if (!header) {
                        ImGui::Spacing();
                        ImGui::TextColored(ImGui::ColorConvertU32ToFloat4(NODE_TYPES[t].color), "%s", CATEGORY_NAMES[c]);
                        ImGui::Separator();
                        header = true;
                    }
                    if (firstMatch < 0) firstMatch = t;
                    ImGui::PushID(t);
                    if (ImGui::Selectable(NODE_TYPES[t].label)) created = t;
                    ImGui::PopID();
                }
            }
            if (firstMatch < 0) ImGui::TextDisabled("Aucun bloc ne correspond.");
            ImGui::EndChild();
            if (enter && firstMatch >= 0) created = firstMatch;
            if (created >= 0) {
                AddNodeAt(obj, created, m_BpMenuPos, linking ? m_BpMenuLinkFrom : -1, m_BpMenuLinkPin);
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
        if (ImGui::BeginPopup("##bp_node_ctx")) {
            int n = m_BpContextNode;
            if (n >= 0 && n < (int)bp.size()) {
                ImGui::TextDisabled("%s", NODE_TYPES[bp[n].type].label);
                ImGui::Separator();
                if (ImGui::MenuItem("Dupliquer")) {
                    BlueprintNode copy = bp[n];
                    copy.pos.x += 30.0f; copy.pos.y += 30.0f;
                    copy.next = -1; copy.nextFalse = -1;
                    bp.push_back(copy);
                    m_SelectedNode = (int)bp.size() - 1;
                }
                if (ImGui::MenuItem("Couper tous ses fils")) {
                    bp[n].next = -1; bp[n].nextFalse = -1;
                    for (auto& other : bp) {
                        if (other.next == n) other.next = -1;
                        if (other.nextFalse == n) other.nextFalse = -1;
                    }
                }
                if (ImGui::MenuItem("Supprimer", "Suppr")) {
                    RemoveNode(bp, n);
                    m_SelectedNode = -1;
                }
            }
            ImGui::EndPopup();
        }

        ImGui::EndChild();
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
            case P_VARNAME:   return node.sparam.empty() ? "var" : node.sparam;
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
            case P_VARNAME:
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
    WEngine::Camera m_EditorCamBackup; // pose de la camera d'edition avant Jouer
    float m_Time = 0.0f;
    float m_LastFrameTime = 0.0f;
    float m_FrameDt = 0.0f;
    WEngine::Mat4 m_LastViewProj;
    float m_ViewX = 0.0f, m_ViewY = 0.0f, m_ViewportW = 1.0f, m_ViewportH = 1.0f;

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
    bool m_PlayerHasCharacter = false; // un "Depart Joueur" existe-t-il dans la scene ?
    bool m_NoViewInPlay = false;       // ni personnage ni camera active : ecran noir volontaire
    WEngine::Vec3 m_PlayerPos{ 0.0f, 1.0f, 6.0f };
    WEngine::Vec3 m_PlayerSpawn{ 0.0f, 1.0f, 6.0f };
    WEngine::Vec3 m_PlayerVelXZ{ 0.0f, 0.0f, 0.0f };
    WEngine::Vec3 m_CondObjectPos{ 0.0f, 0.0f, 0.0f };
    bool m_CondObjectTouching = false;
    bool m_PlayerFrozen = false; // "Bloquer les controles du joueur" (deplacement au clavier)
    float m_CoyoteTimer = 0.0f, m_JumpBuffer = 0.0f;
    bool m_SpaceWasDown = false;
    float m_PlayerVelY = 0.0f;
    bool m_PlayerGrounded = true;
    bool m_PlayerMoving = false;
    float m_PlayerFacingYaw = 0.0f;

    // Apparence du personnage : par defaut le petit bonhomme procedural,
    // ou un modele .obj importe de Blender si on en choisit un.
    std::string m_PlayerModelPath;
    WEngine::Vec3 m_PlayerTint{ 1.0f, 1.0f, 1.0f };
    float m_PlayerScale = 1.0f;
    float m_WalkCycle = 0.0f;
    float m_SquashTimer = 0.0f;

    bool m_LeftWasDown = false, m_RightWasDown = false, m_MiddleWasDown = false;
    enum NavModeKind { Nav_None, Nav_LmbPending, Nav_LmbFly, Nav_Orbit, Nav_Pan, Nav_Dolly };
    int m_NavMode = Nav_None;
    float m_NavLastX = 0.0f, m_NavLastY = 0.0f, m_NavPressX = 0.0f, m_NavPressY = 0.0f;
    float m_OrbitDist = 8.0f;
    int m_HoverAxis = -1;
    bool m_GameView = false;      // touche G : cache grille, gizmo et reperes d'edition
    bool m_LoopWarned = false;
    bool m_ClearUiFocus = false;
    bool m_BpWindowFocused = false;

    // Historique : dernier etat "valide" et son texte (pour comparer vite).
    std::vector<SceneObject> m_Committed;
    std::string m_CommittedText;
    bool m_UndoCheckNeeded = false;
    bool m_WasInteracting = false;
    int m_DraggingAxis = -1;
    WEngine::Vec3 m_DragOriginPos;
    float m_DragStartOffset = 0.0f;

    bool m_ShowScriptEditor = false;
    int m_ScriptTarget = -1;
    int m_SelectedNode = -1;
    ImVec2 m_BpScroll{ 0.0f, 0.0f }, m_BpOrigin{ 0.0f, 0.0f };
    float m_BpZoom = 1.0f;
    int m_BpDragNode = -1, m_BpLinkDragNode = -1, m_BpLinkDragPin = 0;
    bool m_BpRmbActive = false;
    float m_BpRmbMoved = 0.0f;
    bool m_BpMenuRequest = false;
    ImVec2 m_BpMenuPos{ 0.0f, 0.0f };
    int m_BpMenuLinkFrom = -1, m_BpMenuLinkPin = 0;
    int m_BpContextNode = -1;
    bool m_BpFitRequest = false;
    std::string m_BpSearch;
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
